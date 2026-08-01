const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'shopping-list',
      script: 'backend/index.js',
      cwd: path.join(__dirname, '..'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'development',
        PORT: 3101,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3101,
      },
    },
  ],
};
