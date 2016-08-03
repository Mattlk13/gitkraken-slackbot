// const ADMIN = 'U04CT4Y06' //jordan_wallet
const BOT_TOKEN = require('./token.js');
const SLACKUP_CHANNEL_ID = 'C0P38P755';

const Botkit = require('botkit');
const Promise = require('bluebird');
const _ = require('lodash');

// messy global varaibles
const controller = Botkit.slackbot({
  json_file_store: './saveData'
});

const bot = controller.spawn({
  token: BOT_TOKEN
});

const userInfo = {};

/* ### PROMISIFY API CALLS - turns e.g. channels.info into channels.infoAsync which returns a promise ### */
bot.api.chat = Promise.promisifyAll(bot.api.chat);
bot.api.channels = Promise.promisifyAll(bot.api.channels);
bot.api.im = Promise.promisifyAll(bot.api.im);
bot.api.users = Promise.promisifyAll(bot.api.users);
controller.storage.channels = Promise.promisifyAll(controller.storage.channels);


// helpers
const updateUserInfo = (user) =>
  bot.api.users.infoAsync({ user })
    .then((_response) => {
      userInfo[user] = _response.user;
    });

const updateChannelMembers = () =>
  bot.api.channels.infoAsync({ channel: SLACKUP_CHANNEL_ID })
    .then((response) => {
      const members = response.channel.members;
      const promises = [];
      members.forEach((member) => {
        if (userInfo[member]) {
          return;
        }

        promises.push(updateUserInfo(member));
      });
      return Promise.all(promises);
    });

// const findUserByName = (userName) => {
//   const name = userName.toLowerCase();
//   return updateChannelMembers()
//     .then(() => _.find(userInfo, { name }));
// };

const publicMessage = (text) =>
  bot.api.chat.postMessageAsync({ as_user: true, channel: SLACKUP_CHANNEL_ID, text });

const privateMessage = (user, text) =>
  bot.api.im.openAsync({ user })
    .then((response) => bot.api.chat.postMessageAsync({ as_user: true, channel: response.channel.id, text }));


const privateMessageJordan = (text) =>
  bot.api.im.openAsync({ user: 'U04CT4Y06' })
    .then((response) => bot.api.chat.postMessageAsync({ as_user: true, channel: response.channel.id, text }));

const ensureChannelData = () => {
  const today = (new Date()).getDate();

  let resolve;
  let reject;
  const waitFor = new Promise((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });

  controller.storage.channels.get(SLACKUP_CHANNEL_ID, (err, _channelData) => {
    if (err) {
      reject(err);
    }

    const channelData = _channelData || {};

    if (!channelData.userMessages) {
      channelData.userMessages = {};
    }

    const { userMessages } = channelData;

    if (!userMessages[today]) {
      userMessages[today] = {};
    }

    controller.storage.channels.save({
      id: SLACKUP_CHANNEL_ID,
      userMessages
    }, (_err) => {
      if (_err) {
        reject(_err);
      } else {
        resolve();
      }
    });
  });

  return waitFor;
};

// const getUserMessage = (user) => {
//   return ensureChannelData()
//     .then(() => controller.storage.channels.getAsync(SLACKUP_CHANNEL_ID))
//     .then((channelData) => {
//       const today = (new Date()).getDate();
//       const {
//         userMessages: {
//           [today]: todaysMessages
//         }
//       } = channelData;
//
//       return todaysMessages[user];
//     });
// };

const getAllUserMessages = () =>
  ensureChannelData()
    .then(() => controller.storage.channels.getAsync(SLACKUP_CHANNEL_ID))
    .then((channelData) => {
      const today = (new Date()).getDate();

      const {
        userMessages: {
          [today]: todaysMessages
        }
      } = channelData;

      return Promise.all(
        _(todaysMessages).keys().map(updateUserInfo).value() // eslint-disable-line newline-per-chained-call
      )
        .then(() =>
          _.reduce(todaysMessages, (result, text, user) =>
            `${result}${result ? '\n' : ''} • ${userInfo[user].name}: ${text}`
          , '')
        );
    });

const saveUserMessage = (user, text) => {
  const today = (new Date()).getDate();

  let resolve;
  let reject;
  const waitFor = new Promise((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });

  ensureChannelData()
    .then(() => {
      controller.storage.channels.get(SLACKUP_CHANNEL_ID, (err, channelData) => {
        if (err) {
          reject();
        }

        const {
          userMessages,
          userMessages: {
            [today]: todaysMessages
          }
        } = channelData;

        todaysMessages[user] = text;

        controller.storage.channels.save({
          id: SLACKUP_CHANNEL_ID,
          userMessages
        }, (_err) => {
          if (_err) {
            reject(_err);
          } else {
            resolve();
          }
        });
      });
    });

  return waitFor;
};

const getSlackupMessage = () =>
  getAllUserMessages()
    .then((messages) => `Here's the slackup messages I got today: \n${messages}`);

// initialize bot
bot.startRTM((error /* , bot, payload */) => {
  if (error) {
    throw new Error('Could not connect to Slack');
  }
  ensureChannelData();
  updateChannelMembers();
});

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

  getSlackupMessage()
    .then(publicMessage);
}
setInterval(checkGiveSlackup, 20000);


// chat logic
// controller.hears(['^score$'], ['direct_message', 'direct_mention'], (_bot, message) => {
//   _bot.reply(message, 'example');
// });
//
// controller.hears(['^wompem$'], ['direct_message', 'direct_mention'], (_bot, message) => {
//   controller.storage.users.get(message.user, (err, userData) => {
//     if (!userData || !userData.wompEm) {
//       privateMessage(message.user, 'You have no WompEm.');
//     } else {
//       privateMessage(message.user, 'You have some WompEm.');
//     }
//   });
// });
//
// controller.hears(['dedede', 'daniel'], ['direct_mention', 'mention', 'ambient'], (_bot, message) => {
//   _bot.reply(message, 'ambient listening example');
// });
//
// controller.hears(['help'], ['direct_message', 'direct_mention'], (_bot, message) => {
//   privateMessage(message.user, 'No one can help you now.');
// });

controller.hears(['.*'], ['direct_message'], (_bot, message) => {
  updateUserInfo(message.user)
    .then(() => {
      if ((new Date()).getHours() >= 19) {
        privateMessage(message.user, 'Today\'s slackup already happened. Let me know tomorrow.');
        return;
      }

      saveUserMessage(message.user, message.text)
        .then(() => privateMessage(message.user, 'Okay! I\'ll make that your message for the next slackup (7PM).'))
        // .then(() => privateMessage(message.user, 'Here\'s the slackup so far:'))
        // .then(() => getAllUserMessages())
        // .then((text) => privateMessage(message.user, text));
    });
});

// controller.on('ambient', () => {
//   // I can just do stuff
// });
//
// const idleFn = function idleFn(_bot, message) {
//   if (message.type !== 'message') {
//     return;
//   }
//
//   controller.storage.users.get(message.user, (error, _userData) => {
//     let userData = _userData;
//     if (!userData) {
//       userData = new UserDataModel(message.user);
//       controller.storage.users.save(userData);
//       return;
//     }
//
//     const now = new Date();
//     if (differentDays(new Date(userData.lastCheckin), now) && now.getDay() !== 0 && now.getDay() !== 6) {
//       // it's been a different day
//     }
//     userData.lastCheckin = now;
//     controller.storage.users.save(userData);
//   });
// };
//
// controller.on('ambient', idleFn);
// controller.on('mention', idleFn);
// controller.on('direct_mention', idleFn);
// controller.on('direct_message', idleFn);
