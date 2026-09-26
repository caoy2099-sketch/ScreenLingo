'use strict';

// Mock workers and fetch promises do not hold the event loop open like real I/O.
// Keep it alive while testing unref'ed watchdogs, and fail if they never fire.
function withTestDeadline(promise) {
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Expected the service watchdog to settle within 5 seconds.'));
    }, 5000);
  });

  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

module.exports = { withTestDeadline };
