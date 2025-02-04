const venom = require('venom-bot');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const cron = require('node-cron');
const moment = require('moment'); // Para trabalhar com datas

const app = express();
const PORT = 3000;
app.use(express.json());
app.use(cors());

// Banco de dados SQLite
const db = new sqlite3.Database('./barbearia.db', (err) => {
  if (err) console.error(err.message);
  console.log('Conectado ao banco de dados SQLite.');
});

// Criar tabela se não existir
db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT,
  telefone TEXT,
  horario TEXT,
  servicos TEXT,
  barbeiro TEXT,
  status_confirmacao TEXT DEFAULT NULL
)`);

// Inicia o bot do WhatsApp
venom.create({
    session: 'barbearia-bot',
    browserArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: 'new' // Adiciona a nova opção de modo headless
}).then((client) => {  
  let userState = {};

  // Função para enviar a confirmação automática
  function enviarConfirmacao() {
    db.all('SELECT * FROM agendamentos WHERE status_confirmacao IS NULL', [], (err, rows) => {
      if (err) {
        console.error('Erro ao buscar agendamentos:', err.message);
        return;
      }

      rows.forEach((agendamento) => {
        const userId = agendamento.telefone;
        const nome = agendamento.nome;
        const horario = agendamento.horario;

        // Envia a mensagem de confirmação
        client.sendText(userId, `Olá ${nome}, lembrando que seu agendamento está marcado para ${horario}. Por favor, confirme se você ainda irá comparecer. Responda "confirmo" ou "não confirmo".`);

        // Atualiza o status da confirmação para "pendente"
        db.run('UPDATE agendamentos SET status_confirmacao = "pendente" WHERE id = ?', [agendamento.id], (err) => {
          if (err) {
            console.error('Erro ao atualizar o status de confirmação:', err.message);
          }
        });

        // Agora, calcular o tempo para enviar a segunda confirmação 1 hora antes do agendamento
        // Agora, calcular o tempo para enviar a segunda confirmação 3 minutos antes do agendamento
        const horarioAgendamento = moment(horario, 'HH:mm'); // Agora aceitando o formato 'HH:mm'

        const horaDeConfirmacao = horarioAgendamento.subtract(3, 'minutes'); // Subtrai 3 minutos do agendamento

        // Calcular a diferença de tempo em milissegundos
        const tempoRestante = horaDeConfirmacao.diff(moment());

        // Verifica se a hora de confirmação está no futuro
        if (tempoRestante > 0) {
        // Enviar segunda confirmação 3 minutos antes do agendamento
        setTimeout(() => {
            client.sendText(userId, `Olá ${nome}, só para confirmar, seu corte está agendado para às ${horario}. Você ainda vai comparecer? Caso contrário, podemos encaixar outro cliente.`);
        }, tempoRestante);
        } else {
        // Caso o tempo já tenha passado (se o horário de confirmação já passou)
        client.sendText(userId, `O agendamento já passou. Se precisar remarcar, entre em contato.`);
        }

      });
    });
  }

  // Agendar a confirmação automática 24 horas antes do horário do agendamento
  cron.schedule('0 9 * * *', () => {  // Exemplo: a cada dia, às 9h (ajustar para sua necessidade)
    enviarConfirmacao();
  });

  client.onMessage((message) => {
    const userId = message.from;

    if (message.body.toLowerCase().includes('agendar')) {
      client.sendText(userId, 'Por favor, informe seu nome e o horário desejado. Exemplo: João, 14h');
      userState[userId] = { step: 'name_and_time' };
    } else if (userState[userId] && userState[userId].step === 'name_and_time' && message.body.includes(',')) {
      const [nome, horario] = message.body.split(',').map((item) => item.trim());
      userState[userId] = { nome, horario, step: 'choose_service' };

      client.sendText(userId, 'Agora, escolha os serviços desejados (digite os números separados por vírgula):\n1. Corte de cabelo\n2. Corte de barba\n3. Sobrancelha');
    } else if (userState[userId] && userState[userId].step === 'choose_service') {
      const servicosEscolhidos = message.body.trim().split(',').map((num) => num.trim());

      const validServices = ['1', '2', '3']; // Serviços válidos

      const isValid = servicosEscolhidos.every((num) => validServices.includes(num));

      if (!isValid) {
        client.sendText(userId, 'Por favor, escolha os serviços válidos (1, 2, 3) separados por vírgula. Exemplo: 1, 2');
        return;
      }

      const servicos = servicosEscolhidos
        .map((num) => {
          switch (num) {
            case '1':
              return 'Corte de cabelo';
            case '2':
              return 'Corte de barba';
            case '3':
              return 'Sobrancelha';
            default:
              return null;
          }
        })
        .filter(Boolean)
        .join(', ');

      userState[userId].servicos = servicos;
      userState[userId].step = 'choose_barber';

      client.sendText(userId, 'Agora, escolha o barbeiro (digite o número correspondente):\n1. Emanuele gostosa 1\n2. Meu Amoreco 2\n3. Ela é uma delicinha mesmo 3\n4. Qualquer um');
    } else if (userState[userId] && userState[userId].step === 'choose_barber') {
      const barbeirosValidos = ['1', '2', '3', '4'];
      const barbeiroEscolhido = message.body.trim();

      if (!barbeirosValidos.includes(barbeiroEscolhido)) {
        client.sendText(userId, 'Escolha um barbeiro válido. Responda com 1, 2, 3 ou 4.');
        return;
      }

      let barbeiro = '';
      switch (barbeiroEscolhido) {
        case '1':
          barbeiro = '1 Emanuele gostosa';
          break;
        case '2':
          barbeiro = '2 Meu Amoreco';
          break;
        case '3':
          barbeiro = '3 Ela é uma delicinha mesmo';
          break;
        case '4':
          barbeiro = 'Qualquer um';
          break;
      }

      userState[userId].barbeiro = barbeiro;
      const { nome, horario, servicos } = userState[userId];

      db.run(`INSERT INTO agendamentos (nome, telefone, horario, servicos, barbeiro) VALUES (?, ?, ?, ?, ?)`, [nome, userId, horario, servicos, barbeiro], function(err) {
        if (err) {
          console.error('Erro ao salvar agendamento no banco de dados:', err.message);
          client.sendText(userId, 'Ocorreu um erro ao agendar. Tente novamente.');
        } else {
          client.sendText(userId, `Agendamento confirmado para ${nome} às ${horario} com os serviços: ${servicos} e barbeiro: ${barbeiro}.`);
          userState[userId] = null;
        }
      });
    }

    if (message.body.toLowerCase().includes('confirmo') || message.body.toLowerCase().includes('não confirmo')) {
      const resposta = message.body.toLowerCase().includes('confirmo') ? 'confirmado' : 'cancelado';

      db.run('UPDATE agendamentos SET status_confirmacao = ? WHERE telefone = ? AND status_confirmacao IS NULL', [resposta, userId], function(err) {
        if (err) {
          console.error('Erro ao atualizar a confirmação no banco de dados:', err.message);
        } else {
          client.sendText(userId, `Seu agendamento foi ${resposta}.`);
        }
      });
    }

    if (message.body.toLowerCase().includes('obrigado') || message.body.toLowerCase().includes('tchau')) {
      client.sendText(userId, 'Agradecemos pelo seu contato! Se precisar de mais alguma coisa, estamos à disposição. Até logo!');
      userState[userId] = null;
    }
  });
});

// API para listar agendamentos
app.get('/agendamentos', (req, res) => {
  db.all('SELECT * FROM agendamentos', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
