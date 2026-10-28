fetch('http://localhost:5173/')
  .then((r) => process.exit(r.ok ? 0 : 1))
  .catch(() => process.exit(1));
