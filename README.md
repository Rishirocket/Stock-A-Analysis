# A+ Stocks

Clean Railway/GitHub-ready React + Express app.

## Deploy
1. Create a new GitHub repo.
2. Upload all files from this folder, not the ZIP itself.
3. Connect GitHub repo to Railway.
4. In Railway Variables, add:

```bash
MASSIVE_API_KEY=your_key_here
```

You can also use:

```bash
POLYGON_API_KEY=your_key_here
```

Railway will run:

```bash
npm install
npm run build
npm start
```

Important: Do not upload `node_modules`.
