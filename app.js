var express = require('express');
var session = require('express-session');
var path = require('path');
var proxy = require('express-http-proxy');
var logger = require('morgan');
var bodyParser = require('body-parser');
var cors = require('cors');

const jwt = require('jwt-simple');

var ocfl = require('./controllers/ocfl');
var check_jwt = require('./controllers/check_jwt');

var MemcachedStore = require("connect-memcached")(session);

var app = express();

var env = app.get('env');
var config = require('./config/express.json')[env];

app.use(logger('dev'));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('trust proxy', 1);


app.use(session({
	secret: config.session.secret,
	resave: false,
	saveUninitialized: false,
	proxy: true,
	store: new MemcachedStore({
		hosts: [ config.session.server ]
	}),
	cookie: {
		maxAge: config.session.expiry * 60 * 60 * 1000
	}

}));

if( config['cors'] ) {
	app.use(cors());
}


// checkSession: middleware which checks that the user is logged in and has
// values in their session which match what's expected in config.auth.allow.
//
// if the route is /jwt, let it through without checking (because this is the
// return URL from AAF)
// if the route is /, redirect to AAF if there's no session or uid

function checkSession(req, res, next) {
	console.log(`checkSession: ${req.url}`);
	if( req.url === '/jwt/' || req.url === '/jwt' || config['auth']['UNSAFE_MODE'] ) {
		next();
	} else {
	// if( config['auth']['UNSAFE_MODE'] ) {
	// 	next();
	// }
		const allow = config['auth']['allow'];
		if( ! req.session ||  ! req.session.uid ) {
			if( req.url === '/' ) {
				res.redirect(303, config.auth.authURL);
			} else {
				res.status(403).send("Forbidden");
			}
		} else {		
			var ok = true;
			for( field in allow ) {
				if( !(field in req.session) || ! req.session[field].match(allow[field]) ) {
					ok = false;
					console.log(`session check failed for ${field} ${req.session[field]}`);
				}
			}
			if( ok ) {
				next();
			} else {
				req.status(403).send("Forbidden");
			}
		}	
	} 
}


app.use(checkSession);



// authentication endpoint


app.post('/jwt', (req, res) => {

	const authjwt = jwt.decode(req.body['assertion'], config.auth.jwtSecret);
	if( check_jwt(config.auth, authjwt) ) {
		console.log("AAF authentication was successful");
		const atts = authjwt[config.auth.attributes];
		req.session.uid = atts['mail'];
		req.session.displayName = atts['displayname'];
		req.session.affiliation = atts['edupersonscopedaffiliation'];
		res.redirect('/');
	} else {
		console.log("AAF authentication failed");
		res.sendStatus(403);
	}

});






app.post("/auth", (req, res) => {
});



// anything past this point just gives a 403 if there's no uid in the session

// ocfl-express endpoints


app.get('/ocfl/', async (req, res) => {
	console.log(`/ocfl/ Session id: ${req.session.id}`);
	// if( !req.session.uid ) {
	// 	console.log("/ocfl/repo endpoint: no uid in session");
	//  	res.status(403).send("Forbidden");
	//  	return;
	// }
	if( config.ocfl.autoindex ) {
		const index = await ocfl.index(config, req.params.repo, req.query);
		res.send(index);
	} else {
		console.log("Repository indexing is not configured");
		res.status(404).send("Repository index is not configured");
	}
});

// fixme: make cache-control no-store

app.get('/ocfl/:oidv/:content?', async (req, res) => {
	console.log(`/ocfl/ Session id: ${req.session.id}`);
	console.log(`ocfl: session = ${req.session.uid}`);
	// if( !req.session.uid ) {
	// 	console.log("/ocfl/repo/oid: no uid found in session");
	//  	res.status(403).send("Forbidden");
	//  	return;
	// }

	if( config.ocfl.referrer && req.headers['referer'] !== config.ocfl.referrer ) {
		console.log(`Request referrer ${req.headers['referer']} does not match ${config.ocfl.referrer}`);
		res.status(403).send("Forbidden");
	} else {

		var content = req.params.content;
  		var oidparts = req.params.oidv.split('.v');
  		var oid = oidparts[0];
  		var v = ( oidparts.length === 2 ) ? 'v' + oidparts[1] : '';
		
		if( !content || content.slice(-1) === '/' ) {
			if( config.ocfl.index_file ) {
				const index_file = content ? content + config.ocfl.index_file : config.ocfl.index_file;  
				const file = await ocfl.file(config, oid, v, index_file);
				if( file ) {
					res.sendFile(file);
					return;
				} 
				// if the index_file is not found, fall through to autoindex if
				// it's configured
			}
			if( config.ocfl.autoindex ) {
				const index = await ocfl.index(config, req.query, oid, v, content);
				if( index ) {
					res.send(index);
				} else {
					res.status(404).send("Not found");
				}
			} else {
				console.log("Autoindex not available");
				res.status(404).send("Autoindex is not available");
			}
		} else {
			const file = await ocfl.file(config, oid, v, content);
			if( file ) {
				res.sendFile(file);
			} else {
				res.status(404).send("Not found");
			}
		}
	}
});

// solr proxy - only allows select queries 


app.use('/solr/ocfl/select*', proxy(config['solr'], {
  filter: (req, res) => {
	// console.log(`/solr/:core/ Session id: ${req.session.id}`);
	// console.log(`solr: session = ${req.session.uid}`);

 //  	if( ! req.session.uid ) {
	// 	console.log("/solr/:core/ No iud found in session");
 //  		return false;
 //  	}
  	if( req.method !== 'GET') {
  		return false;
  	}
  	return true;
  },
  proxyReqPathResolver: (req) => {
  	console.log(`resolving solr proxy: ${req.originalUrl}`);
  	return req.originalUrl;
  } 
}));



// data portal front page


// app.use('/', ( req, res, next ) => {
// 	console.log(`/: session id = ${req.session.id}`);
// 	console.log(`/: session = ${req.session.uid}`);
// 	console.log(`/: affiliation = ${req.session.affiliation}`);
// 	if( req.session.uid ) {
// 		next();
// 	} else {
// 		console.log("/: no iud found in session");
// 		res.redirect(303, config.auth.authURL);
// 	}
// });


app.use('/', express.static(path.join(__dirname, 'portal')));










module.exports = app;
