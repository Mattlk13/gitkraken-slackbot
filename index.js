const Botkit = require('botkit');
const Promise = require('bluebird');
const _ = require('lodash');
const moment = require('moment');

const BOT_TOKEN = require('./token.js');
const SLACKUP_CHANNEL_ID = 'C0P38P755';
const LOGGING_LEVEL = 1;
const VERBOSE_LOGGING = 2;
const SILLY_LOGGING = 3;


/* ### MESSY GLOBAL VARIABLES ### */
const controller = Botkit.slackbot({
  json_file_store: './saveData'
});

const bot = controller.spawn({
  token: BOT_TOKEN
});

const Database = require('./src/Database.js')(controller, bot, SLACKUP_CHANNEL_ID, LOGGING_LEVEL);
const Message = require('./src/Message.js')(controller, bot, SLACKUP_CHANNEL_ID);
const Util = require('./src/Util.js')(LOGGING_LEVEL);


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
        Util.log('reminder', `User messages exist for the following users: ${_.keys(userMessages)}.`, SILLY_LOGGING);
        Util.log('reminder', `User reminders exist for the following users: ${_.keys(userReminders)}.`, SILLY_LOGGING);
        const usersNeedingReminder = _(userReminders)
          .pickBy((reminder, user) => !userMessages[user])
          .pickBy(({ lastReminder: _lastReminder, timeOfDay: _timeOfDay }, user) => {
            const timeOfDay = moment(_timeOfDay);
            const lastReminder = moment(_lastReminder);
            const timeUserWantsReminder = moment([
              theTime.year(),
              theTime.month(),
              theTime.date(),
              timeOfDay.hour(),
              timeOfDay.minute()
            ]);

            Util.log('reminder', `User ${user} wants a reminder at ${timeUserWantsReminder.toString()}.`
              + ` They last received a reminder at ${lastReminder.toString()}`, SILLY_LOGGING);

            // Send a reminder if we've hit or passed the reminder time and EITHER:
            //  - We haven't sent a reminder today
            //  - The reminder we sent was earlier than the reminder time (the user got a reminder then set a new one)
            return theTime.isSameOrAfter(timeUserWantsReminder, 'minute') &&
              (!lastReminder.isSame(theTime, 'day') || lastReminder.isBefore(timeUserWantsReminder, 'minute'));
          })
          .keys()
          .value();

        if (_.isEmpty(usersNeedingReminder)) {
          return;
        }

        _.forEach(usersNeedingReminder, (user) => {
          Util.log('reminder', `Sending slackup reminder to user ${user}`);
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

controller.hears([/^help$/i], ['direct_message'], (_bot, message) => {
  Util.log('help', `Sending help to user ${message.user}`);
  Message.private(message.user,
    'Besides this `help` command, I know the following commands:\n' +
    ' • `remindMeAt [time]`: provide a time in 24-hour `HH:MM` format and each day you haven\'t sent me a slackup' +
    ' message by that time, I\'ll send you a reminder. Use with a blank time to stop getting reminders.\n' +
    '*Anything else will be considered a slackup message.* I can store 1 message from you at a time, so whatever you' +
    ' sent last will be the message I use. At 7pm each day I will post all the slackup messages I have to #gk-slackup.'
  );
});

controller.hears([/^remindMeAt\b/i], ['direct_message'], (_bot, message) => {
  Util.log('remindMeAt', `Received request from user ${message.user}`, VERBOSE_LOGGING);
  const timeString = message.text.split(' ')[1];
  Database.saveUserReminder(message.user, timeString)
    .then((parsedTime) => {
      let botResponse;
      if (!parsedTime) {
        botResponse = '\'Kay, I\'ll stop sending you slackup reminders.';
        Util.log('remindMeAt', `Stopped reminders for user ${message.user}`);
      } else {
        let hours = parsedTime.hour();
        const am = hours < 12;
        hours = hours % 12;
        let minutes = '' + parsedTime.minute(); // eslint-disable-line prefer-template
        while (minutes.length < 2) {
          minutes = `0${minutes}`;
        }
        const friendlyTime = `${hours}:${minutes}${am ? 'am' : 'pm'}`;
        botResponse = `Got it, every ${am ? 'morning' : 'afternoon'} at ${friendlyTime}` +
          ' I\'ll remind you if you haven\'t sent me a slackup message.';
        Util.log('remindMeAt', `Set user ${message.user} to time ${friendlyTime}`);
      }

      Message.private(message.user, botResponse);
    })
    .catch((reason) => {
      Util.log('remindMeAt', `Failed for reason: ${reason}`);
      Message.private(message.user, reason);
    });
});

controller.hears([/.+/], ['direct_message'], (_bot, message) => {
  Util.log('unmatched', `Received unmatched message from user ${message.user}`, VERBOSE_LOGGING);
  Database.updateChannelMembers(true)
    .then((userInfo) => {
      if (!userInfo[message.user]) {
        Util.log('unmatched', `User ${message.user} was not detected in slackup channel; ignoring.`, VERBOSE_LOGGING);
        Message.private(message.user, 'I\'m only for members of #gk-slackup!');
        return;
      }

      const theTime = moment();
      if (theTime.day() === 0 || theTime.day() === 6) {
        Util.log('unmatched', 'It\'s the weekend, so message is ignored.', VERBOSE_LOGGING);
        Message.private(message.user, 'There\'s no slackup on the weekends. Let me know on Monday.');
        return;
      }

      if (gaveTodaysSlackup) {
        Util.log('unmatched', 'Today\'s slackup already occured, so message is ignored.', VERBOSE_LOGGING);
        Message.private(message.user, 'Today\'s slackup already happened. Let me know tomorrow.');
        return;
      }

      const { user } = message;
      const username = userInfo[user].name;
      Util.log('unmatched', `User ${user} (${username}) set their slackup message to: ${message.text}`);
      Database.saveUserMessage(message.user, message.text)
        .then(() => Message.private(message.user, 'Okay! I\'ll make that your message for the next slackup (7pm).'));
    });
});
