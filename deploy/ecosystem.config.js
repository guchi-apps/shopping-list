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
      // PM2 は max_memory_restart による再起動やサーバー再起動後の resurrect で
      // プロセスを起動し直す際、pm2 start 時に指定した --env production を失って
      // 既定の env にフォールバックすることがある。development で起動されると
      // Apache のプロキシ先（127.0.0.1:3101）と食い違って 503 になるため、
      // 既定の env も本番と同じ値にしておく。
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3101,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3101,
      },
    },
  ],
};
