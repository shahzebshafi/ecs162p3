const express = require('express');
const expressHandlebars = require('express-handlebars');
const session = require('express-session');
const canvas = require('canvas');
const { createCanvas } = require('canvas');
const sqlite3 = require('sqlite3');
const sqlite = require('sqlite');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();
const path = require('path');
const dbFileName = 'storage.db'
const bcrypt = require('bcrypt');
const fs = require('fs')

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Configuration and Setup
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/auth/google/callback';
const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

/*
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    Handlebars Helpers

    Handlebars helpers are custom functions that can be used within the templates 
    to perform specific tasks. They enhance the functionality of templates and 
    help simplify data manipulation directly within the view files.

    In this project, two helpers are provided:
    
    1. toLowerCase:
       - Converts a given string to lowercase.
       - Usage example: {{toLowerCase 'SAMPLE STRING'}} -> 'sample string'

    2. ifCond:
       - Compares two values for equality and returns a block of content based on 
         the comparison result.
       - Usage example: 
            {{#ifCond value1 value2}}
                <!-- Content if value1 equals value2 -->
            {{else}}
                <!-- Content if value1 does not equal value2 -->
            {{/ifCond}}
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
*/

// Set up Handlebars view engine with custom helpers
//
app.engine(
    'handlebars',
    expressHandlebars.engine({
        helpers: {
            toLowerCase: function (str) {
                return str.toLowerCase();
            },
            ifCond: function (v1, v2, options) {
                if (v1 === v2) {
                    return options.fn(this);
                }
                return options.inverse(this);
            },
        },
    })
);

app.set('view engine', 'handlebars');
app.set('views', './views');

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Middleware
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

app.use(
    session({
        secret: 'oneringtorulethemall',     // Secret key to sign the session ID cookie
        resave: false,                      // Don't save session if unmodified
        saveUninitialized: false,           // Don't create session until something stored
        cookie: { secure: false },          // True if using https. Set to false for development without https
    })
);

// Replace any of these variables below with constants for your application. These variables
// should be used in your template files. 
// 
app.use((req, res, next) => {
    res.locals.appName = 'MicroBlog';
    res.locals.copyrightYear = 2024;
    res.locals.postNeoType = 'Post';
    res.locals.loggedIn = req.session.loggedIn || false;
    res.locals.userId = req.session.userId || '';
    next();
});

app.use(express.static('public'));                  // Serve static files
app.use(express.urlencoded({ extended: true }));    // Parse URL-encoded bodies (as sent by HTML forms)
app.use(express.json());                            // Parse JSON bodies (as sent by API clients)

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Routes
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Home route: render home view with posts and user
// We pass the posts and user variables into the home
// template
//

app.get('/', async (req, res) => {
    const posts = await getPosts();
    const user = await getCurrentUser(req) || {};
    const tags = ['popular', 'new', 'trending']
    res.render('home', { posts, user , tags});

});

// Redirect to Google's OAuth 2.0 server
app.get('/auth/google', (req, res) => {
    const url = client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
    });
    res.redirect(url);
});

// Handle OAuth 2.0 server response
app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({
        auth: client,
        version: 'v2',
    });

    const userinfo = await oauth2.userinfo.get();

    let hash = await bcrypt.hash(userinfo.data.email, 10)
    let user = await findUserByEmail(userinfo.data.email);

    if (!user) {
        user = await addUser(userinfo.data.email, hash);
        req.session.userId = user.id
        res.redirect('/register')
    }
    else {
        req.session.loggedIn = true;
        req.session.userId = user.id;
        res.redirect('/');
    }
});

// Register GET route is used for error response from registration
//
app.get('/register', (req, res) => {
    res.render('loginRegister', { regError: req.query.error });
});

// Login route GET route is used for error response from login
//
app.get('/login', (req, res) => {
    res.render('googleLogin', { loginError: req.query.error });
});

// Error route: render error page
//
app.get('/error', (req, res) => {
    res.render('error');
});

// Additional routes that you must implement
app.get('/post/:id', (req, res) => {
    const postId = req.params.id;
    const post = posts.find(post => post.id === parseInt(postId));
    if (!post) {
        return res.status(404).send('Post not found');
    }
    res.render('postDetail', { post });
});
app.post('/posts', async (req, res) => {
    addPost(req.body.title, req.body.content ,req.body.tags ,await getCurrentUser(req));
    res.redirect('/');
});
app.post('/like/:id', (req, res) => {
    updatePostLikes(req, res);
});
app.get('/profile', isAuthenticated, async (req, res) => {
    await renderProfile(req, res);

});
app.get('/avatar/:username', (req, res) => {
    handleAvatar(req, res);

});
app.post('/register', (req, res) => {
    registerUser(req, res)
});
app.post('/login', (req, res) => {
    loginUser(req, res);
});
app.get('/logout', (req, res) => {
    logoutUser(req, res);
});

app.get('/popular', async (req, res) => {
    const posts = await getPopularPosts();
    const user = await getCurrentUser(req) || {};
    res.render('home', { posts, user });
});

app.get('/tag/:tag', async (req, res) => {
    const tag = req.params.tag;
    const posts = await getPostsByTag(tag);
    const user = await getCurrentUser(req) || {};
    res.render('home', { posts, user });
});

app.post('/delete/:id', isAuthenticated, async (req, res) => {
    const user = await getCurrentUser(req);
    const loggedIn = req.session.loggedIn;
    const postId = req.params.id;

    if(loggedIn === false) {
        return res.redirect('/login');
    }

    const db = await connectDB();
    const post = await db.get("SELECT * FROM posts WHERE id = ?", [postId]);
    
    if(!post){
        return res.status(404).send('Post not found');
    }

    if(post.username !== user.username){
        return res.status(403).send('Forbidden');
    }

    await db.run("DELETE FROM posts WHERE id = ?", [postId]);

    res.send('Post deleted');
  
   
});



//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Server Activation
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

app.listen(PORT, () => {
   console.log(`Server is running on http://localhost:${PORT}`);
});


//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Support Functions and Variables
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

async function connectDB() {
    try {
        const db = await sqlite.open({ filename: dbFileName, driver: sqlite3.Database });
        return db
    } catch (e) {
        console.log("connectDB: Error trying to connect to db ", e)
    }
}

// Function to find a user by username
async function findUserByUsername(username) {
    try {
        const db = await connectDB()
        return await db.get("SELECT * FROM users WHERE username = ?", [username])
    } catch (e) {
        console.log("findUserByUsername: Error finding ", username, e)
    }
}

async function findUserByEmail(email) {
    try {
        const db = await connectDB()
        const users = await db.all("SELECT * FROM users")
        for (let user of users) {
            const found = await bcrypt.compare(email, user.hashedGoogleId)
            if (found) {
                return user
            }
        }
        return null
    } catch (e) {
        console.log("findUserByUsername: Error finding ", hash, e)
    }
}
// Function to find a user by user ID
async function findUserById(userId) {
    try {
        const db = await connectDB()
        return await db.get("SELECT * FROM users WHERE id = ?", [userId])
    } catch (e) {
        console.log("findUserById: Error finding ", userId, e)
    }
    return users.find(user => user.id === userId);
}

// Function to add a new user
async function addUser(username, hashedId) {
    try {
        const db = await connectDB()
        const users = await db.all("SELECT * FROM users")
        const newUser = { id: users.length + 1, username, hashedGoogleId: hashedId, avatar_url: undefined, memberSince: new Date().toISOString() };

        await db.run(
            "INSERT INTO users (username, hashedGoogleId, avatar_url, memberSince) VALUES (?, ?, ?, ?)",
            [newUser.username, newUser.hashedGoogleId, newUser.avatar_url, newUser.memberSince]
        )
        return newUser;
    } catch (e) { 
        console.log("addUser error adding ", username, hashedId, e)
    }
}

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Function to register a user
async function registerUser(req, res) {
    const {username} = req.body;
    if (!username) {
        return res.redirect('/register?error=Username is required');
    }

    let existing = await findUserByUsername(username)
    if (existing) {
        return res.redirect('register?error=Username already taken')
    }
    const db = await connectDB();

    db.run("UPDATE users SET username = ? WHERE id = ?", [username, req.session.userId])

    req.session.loggedIn = true;
    res.redirect('/');
}

// Function to login a user
async function loginUser(req, res) {
    const {username} = req.body;
    if (!username) {
        return res.redirect('/login?error=Username is required');
    }
    const db = await connectDB();
    const user = await db.get("SELECT * FROM users WHERE username = ?", [username]);
    if (!user) {
        return res.redirect('/login?error=User not found');
    }
    req.session.userId = user.id;
    req.session.loggedIn = true;
    res.redirect('/');
}

// Function to logout a user
function logoutUser(req, res) {
    req.session.loggedIn = false;
    req.session.destroy();
    res.redirect('/');
}

// Function to render the profile page
async function renderProfile(req, res) {
    const user = await getCurrentUser(req);
    const db = await connectDB();

    //const userPosts = posts.filter(post => post.username === user.username);
    if (!user) {
        return res.status(403).send('Forbidden');
    }

    const userPosts = await db.all("SELECT * FROM posts WHERE username = ?", [user.username]);
    res.render('profile', {user, posts: userPosts});
}

// Function to update post likes
async function updatePostLikes(req, res) {
    const postId = req.params.id;
    const db = await connectDB();
    //const post = posts.find(post => post.id === parseInt(postId));
    await db.run("UPDATE posts SET likes = likes + 1 WHERE id = ?", [postId]);

    const post = await db.get("SELECT * FROM posts WHERE id = ?", [postId]);
    if (!post) {
        return res.status(404).send('Post not found');
    }
    //post.likes += 1;
    res.json({ likes: post.likes });
}

// Function to handle avatar generation and serving
async function handleAvatar(req, res) {
    const username = req.params.username;
    const user = await findUserByUsername(username);
    if (!user) {
        return res.status(404).send('User not found');
    }
    const avatar = generateAvatar(username[0]);
    const avatarPath = path.join(__dirname, '/public', '/images', `/${username}.png`)
    const avatarUrl = `images/${username}.png`

    fs.writeFileSync(avatarPath, avatar)

    const db = await connectDB()
    db.run("UPDATE users SET avatar_url = ? WHERE username = ?", [avatarUrl, username])

    res.set('Content-Type', 'image/png');
    res.send(avatar);
}

// Function to get the current user from session
async function getCurrentUser(req) {
    const userId = await req.session.userId;
    return await findUserById(userId);
}

// Function to get all posts, sorted by latest first
async function getPosts() {
    try {
        const db = await connectDB()
        const posts = await db.all("SELECT * FROM posts ORDER BY id DESC")
        for (let post of posts) {
            post.tags = post.tags.split(',')
        }
        return posts
    } catch (e) {
        console.log("getPosts error ", e)
    }
}

async function getPopularPosts() {
    try {
        const db = await connectDB()
        const posts = await db.all("SELECT * FROM posts ORDER BY likes DESC, id DESC")
        return posts
    } catch (e) {
        console.log("getPopularPosts error ", e)
    }
}

// Function to add a new post
async function addPost(title, content, tags , user) {
    try {
        const db = await connectDB()
        const posts = await db.all("SELECT * FROM posts")
        const newPost = {
            id: posts.length + 1,
            title,
            content,
            username: user.username,
            timestamp: new Date().toLocaleDateString(),
            likes: 0,
            tags
        };
        await db.run(
            "INSERT INTO posts (title, content, username, timestamp, likes, tags) VALUES (?, ?, ?, ?, ?, ?)",
            [newPost.title, newPost.content, newPost.username, newPost.timestamp, newPost.likes, newPost.tags]
        )
        return newPost;
    } catch (e) {
        console.log("addPost error ", e)
    }
}
async function getPostsByTag(tag) {
    try {
        const db = await connectDB();
        const posts = await db.all("SELECT * FROM posts");
        const postsByTag = posts.filter(post => post.tags.includes(tag));
        return postsByTag;

        
    } catch (e) {
        console.log("getPostsByTag error ", e);
    }
}

// Function to generate an image avatar
function generateAvatar(letter, width = 100, height = 100) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    const colors ={
        'A' : '#FF0000',
        'B' : '#00FF00',
        'C' : '#0000FF',
        'D' : '#FFFF00',
        'E' : '#00FFFF',
        'F' : '#FF00FF',
        'G' : '#FFA500',
        'H' : '#800080',
        'I' : '#FFC0CB',
        'J' : '#A52A2A',
        'K' : '#00FF00',
        'L' : '#808080',
        'M' : '#808000',
        'N' : '#800000',
        'O' : '#000080',
        'P' : '#008080',
        'Q' : '#00FFFF',
        'R' : '#C0C0C0',
        'S' : '#FFD700',
        'T' : '#FF7F50',
        'U' : '#FA8072',
        'V' : '#40E0D0',
        'W' : '#E6E6FA',
        'X' : '#4B0082',
        'Y' : '#F5F5DC',
        'Z' : '#98FF98'
    }
    context.fillStyle = colors[letter.toUpperCase()];
    context.fillRect(0, 0, width, height);

    context.font = '50px sans-serif';
    context.fillStyle = '#FFFFFF';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(letter.toUpperCase(), width / 2, height / 2);

    return canvas.toBuffer();
}

async function initializeDB() {
    const db = await connectDB()

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            hashedGoogleId TEXT NOT NULL UNIQUE,
            avatar_url TEXT,
            memberSince DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            username TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            likes INTEGER NOT NULL,
            tags TEXT
        );
    `);
    await db.close();
}

initializeDB().catch(err => {
    console.error('Error initializing database:', err);
});