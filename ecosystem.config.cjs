module.exports = {
  apps: [
    {
      name: "ava",
      cwd: "./server",
      script: "./dist/index.js",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      kill_timeout: 5000,
    },
  ],
};
