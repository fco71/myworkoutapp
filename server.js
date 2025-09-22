const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// Serve static files from the current directory
app.use(express.static('.'));

// All other GET requests not handled before will return the main page
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(`Workout Tracker app listening at http://localhost:${port}`);
    console.log('Make sure to configure your Firebase settings in firebase-config.js');
});
