const Botkit = require('botkit');
const Promise = require('bluebird');
const _ = require('lodash');
const moment = require('moment');

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

/* ### SET UP PERIODIC MESSAGES INTERVAL ### */
// TODO this is a mess, figure out a smarter system later
// give slackup immediately if bot is started between 7pm and 8pm
let gaveTodaysSlackup = moment().hour() > 19;
function checkGiveSlackup() {
  const theTime = moment();
  if (theTime.day() === 0 || theTime.day() === 6) {
    return; // don't send messages on weekends
  }

  if (theTime.hour() < 19) {
    gaveTodaysSlackup = false;
    Promise.all([Database.getTodaysUserMessages(), Database.getUserReminders()])
      .then(([userMessages, userReminders]) => {
        const usersNeedingReminder = _(userReminders)
          .pickBy((reminder, user) => !userMessages[user])
          .pickBy(({ lastReminder: _lastReminder, timeOfDay: _timeOfDay }) => {
            const lastReminder = moment(_lastReminder);
            const timeOfDay = moment(_timeOfDay);
            // Send a reminder if we've hit or passed the reminder time and EITHER:
            //  - We haven't sent a reminder today
            //  - The reminder we sent was earlier than the reminder time (the user got a reminder then set a new one)
            return theTime.isSameOrAfter(timeOfDay, 'minute') &&
              (!lastReminder.isSame(theTime, 'day') || lastReminder.isBefore(timeOfDay, 'minute'));
          })
          .keys()
          .value();

        _.forEach(usersNeedingReminder, (user) => {
          Message.private(user, 'Psst! You still haven\'t given me a slackup message!');
          userReminders[user].lastReminder = theTime.toISOString(); // eslint-disable-line no-param-reassign
        });

        Database.updateChannelRecord({ userReminders });
      });
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

controller.hears([/^help$/i], ['direct_message'], (/* _bot, */ message) => {
  Message.private(message.user,
    'Besides this `help` command, I know the following commands:\n' +
    ' • `remindMeAt [time]`: provide a time in 24-hour `HH:MM` format and each day you haven\'t sent me a slackup' +
    ' message by that time, I\'ll send you a reminder. Use with a blank time to stop getting reminders.\n' +
    '*Anything else will be considered a slackup message.* I can store 1 message from you at a time, so whatever you' +
    'sent last will be the message I use. At 7pm each day I will post all the slackup messages I have to #gk-slackup.'
  );
});

controller.hears([/^remindMeAt\b/i], ['direct_message'], (_bot, message) => {
  const timeString = message.text.split(' ')[1];
  Database.saveUserReminder(message.user, timeString)
    .then((parsedTime) => {
      let botResponse = '\'Kay, I\'ll stop sending you slackup reminders.';
      if (parsedTime) {
        let hours = parsedTime.hour();
        const am = hours < 12;
        hours = hours % 12;
        let minutes = '' + parsedTime.minute(); // eslint-disable-line prefer-template
        while (minutes.length < 2) {
          minutes = `0${minutes}`;
        }
        botResponse = `Got it, every ${am ? 'morning' : 'afternoon'} at ${hours}:${minutes}${am ? 'am' : 'pm'}` +
        ' I\'ll remind you if you haven\'t sent me a slackup message.';
      }

      Message.private(message.user, botResponse);
    })
    .catch((reason) => {
      Message.private(message.user, reason);
    });
});

controller.hears([/.+/], ['direct_message'], (_bot, message) => {
  Database.updateChannelMembers(true)
    .then((userInfo) => {
      if (!userInfo[message.user]) {
        Message.private(message.user, 'I\'m only for members of #gk-slackup!');
        return;
      }

      const theTime = moment();
      if (theTime.day() === 0 || theTime.day() === 6) {
        Message.private(message.user, 'There\'s no slackup on the weekends. Let me know on Monday.');
        return;
      }

      if (gaveTodaysSlackup) {
        Message.private(message.user, 'Today\'s slackup already happened. Let me know tomorrow.');
        return;
      }

      Database.saveUserMessage(message.user, message.text)
        .then(() => Message.private(message.user, 'Okay! I\'ll make that your message for the next slackup (7pm).'));
    });
});
