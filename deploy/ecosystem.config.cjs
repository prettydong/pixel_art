module.exports = {
  apps: [{
    name: 'pixel-art',
    cwd: '/home/zdong/raDev/pixel_art',
    script: 'backend/dist/main.js',
    interpreter: '/home/zdong/.nvm/versions/node/v22.21.0/bin/node',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    restart_delay: 3000,
    kill_timeout: 20000,
    env: { NODE_ENV: 'production' },
    time: true,
  }],
};
