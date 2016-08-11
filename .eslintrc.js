module.exports = {
  'env': {
    "es6": true,
    "node": true
  },
  'extends': 'airbnb',
  'plugins': [],
  'rules': {
    'max-len': ['error', 120],
    'brace-style': [2, '1tbs', {'allowSingleLine': true }],
    'comma-dangle': [2, "never"]
  }
};
