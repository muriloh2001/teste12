const venom = require('venom-bot');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const moment = require('moment');

const app = express();
const PORT = 3000;
app.use(express.json());
app.use(cors());

const db = new sqlite3.Database('./barbearia.db', (err) => {
  if (err) console.error(err.message);
  console.log('Conectado ao banco de dados SQLite.');
});

db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT,
  telefone TEXT,
  data TEXT,
  horario TEXT,
  servicos TEXT,
  barbeiro TEXT
)`);

const horariosDisponiveis = [
  '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30', '18:00', '18:30'
];

function getAvailableTimes(barbeiro, data, callback) {
  db.all('SELECT horario FROM agendamentos WHERE barbeiro = ? AND data = ?', [barbeiro, data], (err, rows) => {
    if (err) {
      console.error('Erro ao verificar horários:', err.message);
      callback([]);
      return;
    }
    const ocupados = rows.map(row => row.horario);
    const disponiveis = horariosDisponiveis.filter(h => !ocupados.includes(h));
    callback(disponiveis);
  });
}

venom.create({
  session: 'barbearia-bot',
  browserArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
  headless: 'new'
}).then(client => {
  let userState = {};

  client.onMessage(message => {
    const userId = message.from;

    if (message.body.toLowerCase().includes('agendar')) {
      client.sendText(userId, 
        `👋 Olá! Bem-vindo à Barbearia Vicentin!  
        Eu sou a assistente virtual e estou aqui para te ajudar a marcar seu horário de forma rápida e prática. ✂️💈
        
        Aqui você pode agendar seu corte com um dos nossos barbeiros especializados e garantir seu atendimento no melhor horário para você.  

        Para começar, me diga com qual barbeiro você deseja agendar seu horário:  
        1️⃣ Emanuele  
        2️⃣ Felipe  
        3️⃣ Vicentin `
      );
      userState[userId] = { step: 'choose_barber' };
    } else if (userState[userId]?.step === 'choose_barber') {
      const barbeiros = { '1': 'Emanuele', '2': 'Felipe', '3': 'Vicentin' };
      const escolha = message.body.trim();
      if (!barbeiros[escolha]) {
        client.sendText(userId, 'Escolha um barbeiro válido (1, 2 ou 3).');
        return;
      }
      userState[userId].barbeiro = barbeiros[escolha];
      userState[userId].step = 'choose_date';
      client.sendText(userId, 'Agora, informe a data desejada (DD/MM/AAAA).');
    } else if (userState[userId]?.step === 'choose_date') {
      const data = message.body.trim();
      if (!moment(data, 'DD/MM/YYYY', true).isValid()) {
        client.sendText(userId, 'Formato de data inválido. Use DD/MM/AAAA.');
        return;
      }
      userState[userId].data = data;
      userState[userId].step = 'choose_time';
      getAvailableTimes(userState[userId].barbeiro, data, availableTimes => {
        if (availableTimes.length === 0) {
          client.sendText(userId, 'Não há horários disponíveis para esse dia. Escolha outra data.');
          userState[userId].step = 'choose_date';
        } else {
          client.sendText(userId, `Horários disponíveis: ${availableTimes.join(', ')}`);
        }
      });
    } else if (userState[userId]?.step === 'choose_time') {
      const horario = message.body.trim();
      getAvailableTimes(userState[userId].barbeiro, userState[userId].data, availableTimes => {
        if (!availableTimes.includes(horario)) {
          client.sendText(userId, 'Horário indisponível. Escolha outro.');
          return;
        }
        userState[userId].horario = horario;
        userState[userId].step = 'choose_service';
        client.sendText(userId, 'Escolha os serviços (1, 2 ou 3):\n1. Corte de cabelo\n2. Corte de barba\n3. Sobrancelha');
      });
    } else if (userState[userId]?.step === 'choose_service') {
      const servicosEscolhidos = message.body.trim().split(',').map(num => num.trim());
      const servicosMap = { '1': 'Corte de cabelo', '2': 'Corte de barba', '3': 'Sobrancelha' };
      const servicos = servicosEscolhidos.map(num => servicosMap[num]).filter(Boolean).join(', ');

      if (!servicos) {
        client.sendText(userId, 'Escolha serviços válidos (1, 2 ou 3).');
        return;
      }
      userState[userId].servicos = servicos;
      userState[userId].step = 'get_name';
      client.sendText(userId, 'Por favor, informe seu nome completo.');
    } else if (userState[userId]?.step === 'get_name') {
      userState[userId].nome = message.body.trim();
      const { nome, telefone, data, horario, servicos, barbeiro } = {
        ...userState[userId],
        telefone: userId
      };

      db.run(`INSERT INTO agendamentos (nome, telefone, data, horario, servicos, barbeiro) VALUES (?, ?, ?, ?, ?, ?)`,
        [nome, telefone, data, horario, servicos, barbeiro],
        err => {
          if (err) {
            console.error('Erro ao salvar agendamento:', err.message);
            client.sendText(userId, 'Erro ao agendar. Tente novamente.');
          } else {
            client.sendText(userId, `✅ Agendamento confirmado!\n\n📅 Data: ${data}\n⏰ Horário: ${horario}\n💈 Barbeiro: ${barbeiro}\n✂️ Serviços: ${servicos}\n👤 Cliente: ${nome}`);
            userState[userId] = null;
          }
        });
    }
  });
});

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
