module.exports = {
  apps: [
    {
      name: 'repo-backend',
      cwd: './backend',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: '3005',
      },
    },
  ],
};
