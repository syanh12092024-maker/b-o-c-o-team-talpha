module.exports = {
  apps: [
    {
      name: "auus1-frontend",
      cwd: "/Users/tatthanh031298/Desktop/AUUS/dashboard-ui",
      script: "npm",
      args: "run dev",
      interpreter: "none",
      env: {
        NODE_ENV: "development",
        PORT: 3000,
      },
      watch: false,
      max_memory_restart: "500M",
      restart_delay: 3000,
      log_file: "/Users/tatthanh031298/Desktop/AUUS/logs/pm2-frontend.log",
      error_file: "/Users/tatthanh031298/Desktop/AUUS/logs/pm2-frontend-err.log",
      out_file: "/Users/tatthanh031298/Desktop/AUUS/logs/pm2-frontend-out.log",
    },
    {
      name: "auus1-backend",
      cwd: "/Users/tatthanh031298/Desktop/AUUS",
      script: "/Users/tatthanh031298/Desktop/AUUS/.venv/bin/uvicorn",
      args: "faos_brain.api.main:app --host 0.0.0.0 --port 8000 --reload",
      interpreter: "none",
      env: {
        PYTHONPATH: "/Users/tatthanh031298/Desktop/AUUS",
        GOOGLE_APPLICATION_CREDENTIALS: "/Users/tatthanh031298/Desktop/AUUS/bigquery_key.json",
      },
      watch: false,
      max_memory_restart: "500M",
      restart_delay: 3000,
      log_file: "/Users/tatthanh031298/Desktop/AUUS/logs/pm2-backend.log",
      error_file: "/Users/tatthanh031298/Desktop/AUUS/logs/pm2-backend-err.log",
      out_file: "/Users/tatthanh031298/Desktop/AUUS/logs/pm2-backend-out.log",
    },
  ],
};
