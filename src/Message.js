const JORDAN_WALLET = 'U04CT4Y06';

module.exports = (controller, bot, SLACKUP_CHANNEL_ID) => {
  const Message = {
    slackupChannel: (text) =>
      bot.api.chat.postMessageAsync({ as_user: true, channel: SLACKUP_CHANNEL_ID, text }),

    private: (user, text) =>
      bot.api.im.openAsync({ user })
        .then((response) => bot.api.chat.postMessageAsync({ as_user: true, channel: response.channel.id, text })),

    jordan: (text) =>
      bot.api.im.openAsync({ user: JORDAN_WALLET })
        .then((response) => bot.api.chat.postMessageAsync({ as_user: true, channel: response.channel.id, text }))
  };

  return Message;
};
