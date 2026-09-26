'use strict';

const { app } = require('electron');
const path = require('node:path');

if (!process.env.SCREENLINGO_TEST_PROFILE) throw new Error('An isolated test profile is required.');
app.setPath('userData', process.env.SCREENLINGO_TEST_PROFILE);
require(path.join(__dirname, '..', '..', 'src', 'main', 'main.js'));
