const express = require('express');
const expressHandlebars = require('express-handlebars');
const session = require('express-session');
const canvas = require('canvas');
const fs = require('fs');
const { timeStamp } = require('console');

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Configuration and Setup
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const app = express();
const PORT = 3000;

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
    res.locals.appName = 'Reeeddit';
    res.locals.copyrightYear = 2024;
    res.locals.postNeoType = 'Post';
    res.locals.loggedIn = req.session.loggedIn || false;
    res.locals.userId = req.session.userId || '';
    next();
});

app.use(express.static(('public')));                  // Serve static files
app.use(express.urlencoded({ extended: true }));    // Parse URL-encoded bodies (as sent by HTML forms)
app.use(express.json());                            // Parse JSON bodies (as sent by API clients)

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Routes
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Home route: render home view with posts and user
// We pass the posts and user variables into the home
// template
//
app.get('/', (req, res) => {
    const posts = getPosts();
    const user = getCurrentUser(req) || {};
    res.render('home', { posts, user });
});

// Register GET route is used for error response from registration
//
app.get('/register', (req, res) => {
    res.render('loginRegister', { regError: req.query.error });
});

// Login route GET route is used for error response from login
//
app.get('/login', (req, res) => {
    res.render('loginRegister', { loginError: req.query.error });
});

// Error route: render error page
//
app.get('/error', (req, res) => {
    res.render('error');
});

// Additional routes that you must implement


app.get('/post/:id', (req, res) => {
    // TODO: Render post detail page
});
app.post('/posts', (req, res) => {
    addPost(req.body.title, req.body.content, getCurrentUser(req))
    res.redirect("/")
});
app.post('/like/:id', (req, res) => {
    // TODO: Update post likes
});
app.get('/profile', isAuthenticated, (req, res) => {
    renderProfile(req, res)
});
app.get('/avatar/:username', (req, res) => {
    // TODO: Serve the avatar image for the user
});
app.post('/register', (req, res) => {
    registerUser(req, res);
});
app.post('/login', (req, res) => {
    loginUser(req, res)
});
app.get('/logout', (req, res) => {
    logoutUser(req, res)
});
app.post('/delete/:id', isAuthenticated, (req, res) => {
    // TODO: Delete a post if the current user is the owner
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

// Example data for posts and users
// let posts = [
//     { id: 1, title: 'Sample Post', content: 'This is a sample post.', username: 'SampleUser', timestamp: '2024-01-01 10:00', likes: 0 },
//     { id: 2, title: 'Another Post', content: 'This is another sample post.', username: 'AnotherUser', timestamp: '2024-01-02 12:00', likes: 0 },
// ];

// let users = [
//     { id: 1, username: 'SampleUser', avatar_url: undefined, memberSince: '2024-01-01 08:00' },
//     { id: 2, username: 'AnotherUser', avatar_url: undefined, memberSince: '2024-01-02 09:00' },
// ];

var posts;
var users;

fs.readFile('./posts.json', 'utf8', (err, data) => {
    if (err) {
        console.error("error", err)
    }
    else {
        posts = JSON.parse(data)
    }
})

fs.readFile('./users.json', 'utf8', (err, data) => {
    if (err) {
        console.error("error", err)
    }
    else {
        users = JSON.parse(data)
    }
})

// Function to find a user by username
function findUserByUsername(username) {
    return users.find((u) => u.username == username)
}

// Function to find a user by user ID
function findUserById(userId) {
    return users.find((u) => u.id == userId)
}

// Function to add a new user
function addUser(username) {
    d = new Date() + ''
    date = d.split('T')[0]
    time = d.split('T')[1].substring(0,5)
    
    let newUser = {
        id: users.length + 1,
        username: username,
        avatar_url: undefined,
        memberSince: `${date} ${time}`
    }

    users.push(newUser)

    const data = JSON.stringify(users)
    fs.writeFile("./users.json", data, 'utf8', function (e) {
        if (e) {
            return console.log(e)
        }
    })
    return newUser
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
function registerUser(req, res) {
    let user = req.body.username

    if (findUserByUsername(user)){
        res.redirect('/register?error=username+already+registered')
    }
    else {
        user = addUser(user)
        req.session.userId = user.id;
        req.session.loggedIn = true;
        res.redirect('/');
    }
}

// Function to login a user
function loginUser(req, res) {
    let user = req.body.username
    user = findUserByUsername(user)

    if (user) {
        req.session.userId = user.id
        req.session.loggedIn = true;
        res.redirect('/')
    }
    else {
        res.redirect('/login?error=username+not+registered')
    }
}

// Function to logout a user
function logoutUser(req, res) {
    req.session.destroy(e => {
        if (e) {
            res.redirect('/error')
        }
        else {
            res.redirect('/')
        }
    })
}

// Function to render the profile page
function renderProfile(req, res) {
    let user = getCurrentUser(req)
    let posts = getPosts()
    
    posts = posts.filter(post => post.username == user.username)

    res.render("profile", {user, posts})
}

// Function to update post likes
function updatePostLikes(req, res) {
    // TODO: Increment post likes if conditions are met
}

// Function to handle avatar generation and serving
function handleAvatar(req, res) {
    // TODO: Generate and serve the user's avatar image
}

// Function to get the current user from session
function getCurrentUser(req) {
    let id = req.session.userId
    return findUserById(id)
}

// Function to get all posts, sorted by latest first
function getPosts() {
    return posts.slice().reverse();
}

// Function to add a new post
function addPost(title, content, user) {
    let newPost = {
        id : posts.length + 1,
        title : title,
        content: content,
        username : user.username,
        timeStamp : new Date().toISOString(),
        likes : 0
    }

    posts.push(newPost)

    const data = JSON.stringify(posts)
    fs.writeFile("./posts.json", data, 'utf8', function (e) {
        if (e) {
            return console.log(e)
        }
    })
    return newPost
}

// Function to generate an image avatar
function generateAvatar(letter, width = 100, height = 100) {
    // TODO: Generate an avatar image with a letter
    // Steps:
    // 1. Choose a color scheme based on the letter
    // 2. Create a canvas with the specified width and height
    // 3. Draw the background color
    // 4. Draw the letter in the center
    // 5. Return the avatar as a PNG buffer
}