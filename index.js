const Botkit = require('botkit');
const Promise = require('bluebird');

const BOT_TOKEN = require('./token.js');
const SLACKUP_CHANNEL_ID = 'C0P38P755';


/* ### MESSY GLOBAL VARIABLES ### */
const controller = Botkit.slackbot({
  json_file_store: './saveData'
});

const bot = controller.spawn({
  token: BOT_TOKEN
});

const Database = require('./src/Database.js')(controller, bot, SLACKUP_CHANNEL_ID);
const Message = require('./src/Message.js')(controller, bot, SLACKUP_CHANNEL_ID);

/* ### PROMISIFY API CALLS - turns e.g. channels.info into channels.infoAsync which returns a promise ### */
bot.api.chat = Promise.promisifyAll(bot.api.chat);
bot.api.channels = Promise.promisifyAll(bot.api.channels);
bot.api.im = Promise.promisifyAll(bot.api.im);
bot.api.users = Promise.promisifyAll(bot.api.users);
controller.storage.channels = Promise.promisifyAll(controller.storage.channels);
controller.storage.users = Promise.promisifyAll(controller.storage.users);

/* ### INITALIZE BOT ### */
bot.startRTM((error /* , _bot, _payload */) => {
  if (error) {
    throw new Error('Could not connect to Slack');
  }
  Database.updateChannelMembers();
});

/* ### SET UP SLACKUP INTERVAL ### */
let gaveTodaysSlackup = false;
function checkGiveSlackup() {
  const theTime = new Date();
  if (theTime.getDay() === 0 || theTime.getDay() === 6) {
    return; // don't slackup on weekends
  }

  if (theTime.getHours() !== 19 || theTime.getMinutes() !== 0) {
    gaveTodaysSlackup = false;
    return;
  }

  if (gaveTodaysSlackup) {
    return;
  }

  gaveTodaysSlackup = true;
  Database.getSlackupMessage()
    .then(Message.slackupChannel);
}
setInterval(checkGiveSlackup, 20000);


/* ### BOT CHAT LOGIC ### */
// NOTE that order of definition determines priority. The first `hears` that was defined on the controller which matches
//      the chat message in question will be the only one that runs its callback.

controller.hears(['^post$'], ['direct_message'], (/* _bot, _message */) => {
  Database.getSlackupMessage()
    .then(Message.jordan);
});

controller.hears(['.*'], ['direct_message'], (_bot, message) => {
  Database.updateChannelMembers(true)
    .then((userInfo) => {
      if (!userInfo[message.user]) {
        Message.private(message.user, 'I\'m only for members of #gk-slackup!');
        return;
      }
      if ((new Date()).getHours() >= 19) {
        Message.private(message.user, 'Today\'s slackup already happened. Let me know tomorrow.');
        return;
      }

      Database.saveUserMessage(message.user, message.text)
        .then(() => Message.private(message.user, 'Okay! I\'ll make that your message for the next slackup (7PM).'));
    });
});
