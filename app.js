var fs = require("fs");
var GoogleClient = require("./xmpp.js");
var IrcClient = require("./irc.js");

var accountFile = __dirname + '/accounts.json';

var gc = new GoogleClient(process.env['XMPP_USERNAME'], process.env['XMPP_PASSWORD']);
var gcConnected = false;

//user object schema {
//    "id":"[id]",
//    "active":false,
//    "blocked":false,
//    "nick":"[id]|proxy",
//    "xmppAddress":[],
//    "connectingSecret":"[secret]",
//    "permissions":{}
//};


function connectAccount(user){
    if(user.ircc != null){
        console.log("cannot log in account that is already logged in: " + user.account.id);
        return;
    }

    user.ircc = new IrcClient(process.env['PROXY_IRC_SERVER'], process.env['PROXY_IRC_CHANNEL'], user.account.nick);

    user.ircc.addListener('connected',function(){
        if(!user.connected) {
            user.connected = true;
            console.log("user has connected to irc proxy : " + user.account.id);
            if (gcConnected) {
                console.log("sending connected message to " + user.account.xmppAddress[user.account.xmppAddress.length-1]);
                gc.send(user.account.xmppAddress[user.account.xmppAddress.length-1], "!connected to irc!");
            }else{
                console.log("couldn't tell that bot is connected b/c there is no gc connection!!!")
            }
        }else{
            console.log("already connected, ignoring second notify"); //todo make more robust
        }
    });

    user.ircc.addListener('message', function(from, message){
        console.log("got a message from " + from + ", that was: " + message);
		if(!user.account.hasOwnProperty('nobold') || !user.account['nobold']){
			from = "*" + from + "*";
		}
		gc.send(user.account.xmppAddress[user.account.xmppAddress.length-1], from + ": " + message);
			
    });

    user.ircc.addListener('action', function(from, action){
        console.log("got an action from " + from + ", that was: " + action);
        gc.send(user.account.xmppAddress[user.account.xmppAddress.length-1], "*" + from + " " + action);
    });
	
	user.ircc.addListener('serverMessage', function(what){
        console.log("server message :: " + what);
        gc.send(user.account.xmppAddress[user.account.xmppAddress.length-1], "*** " + what + " ***");
    });
}

function disconnectAccount(user, fn){
    user.ircc.end(function () {
        user.ircc = null;
        user.connected = false;

        if(!!fn){fn();}
    });
}

var users = [];

fs.readFile(accountFile, 'utf8', function(err, data){
    var accounts = [];
    try {
        accounts = JSON.parse(data);
    }catch(err){
        console.error("critical error: " + err);
        process.exit();
    }

    users = accounts.map(function(account){
        var user = {
            "account":account,
            "connected":false,
            "ircc":null
        };

        if(account.active){
            connectAccount(user);
        }

        return user;
    });
});


function saveAccounts(fn){
    var accounts = users.map(function(user){return user.account});
    fs.writeFile(accountFile, JSON.stringify(accounts),fn);
}


gc.addListener('connected', function(){
    console.log("connect detected");
    gcConnected = true;
});

gc.addListener('disconnected', function(){
    console.log("disconnect detected");
    gcConnected = false;
});

function quitAll(){
    console.log("exiting (waiting 5 seconds for all connections to terminate...");
    gc.end();
    var connectedUsers = users.filter(function(user){
        return user.account.active;
    });
    var total = connectedUsers.length;
    var quit = 0;

    connectedUsers.map(function(user){disconnectAccount(user, function(){quit++;})});

    var quitOnAllGone;
    var times = 0;
    quitOnAllGone = function(){
        if(total == quit || times >= 10 * 5 ){
            saveAccounts(function(err){
                process.exit();
            });

        }else{
            times++;
            if((times % (1 * 10))==0){
                console.log("waiting " + (5 - (times / 10)) + " more seconds " );
            }
            setTimeout(quitOnAllGone, 100);
        }
    };

    setTimeout(quitOnAllGone, 0);

}


function getAuth(xmppId){
    var foundUsers = users.filter(function(user){
        return user.account.xmppAddress.filter(function(xmpp){return xmpp==xmppId;}).length > 0;
    });

    return foundUsers.length > 0 ? foundUsers[0] : null;
}

gc.addListener('message', function(from, message){
    from = from.replace(/([^\/]*)\/.*/, "$1");
    var args = [];
    var command = null;
    if(message.indexOf("!!") == 0) {
        args = message.slice(2).split(' ');
        command = (args.splice(0, 1)[0]).toLowerCase();
    }

    if(command == "auth")
    {
        if(args.length < 2){
            console.log("not enough params to auth");
            gc.send(from, "!not enough params to auth!");
            return;
        }

        var foundUsers = users.filter(function(user){return user.account.id == args[0];});

        if(foundUsers[0].account.connectingSecret == args[1]){

            //if already in list remove and add to end
            foundUsers[0].account.xmppAddress = foundUsers[0].account.xmppAddress.filter(function(xmpp){return xmpp != from;});

            foundUsers[0].account.xmppAddress.push(from);
            console.log("auth success : " + foundUsers[0].account.id + " = " + from);
            gc.send(from, "!auth success!");

            saveAccounts();

            return;

        }


        console.log("auth failure");
        gc.send(from, "!auth failure!");

        return;

    }

    var authUser = getAuth(from);
    if(!authUser){
        gc.send(from, "!need to auth!");
        return;
    }

    if(!!command)
    {
        switch(command){
            case "killall":

                if(!authUser.account.permissions.admin){
                    console.log("unauthorized attempt to kill all by " + authUser.account.id);
                    gc.send(from, "!this account is not authorized for that action!");
                    return;
                }				

                quitAll();
				
                return;
			
			case "servermsg":
			
				if(!authUser.account.permissions.admin){
                    console.log("unauthorized attempt to kill all by " + authUser.account.id);
                    gc.send(from, "!this account is not authorized for that action!");
                    return;
                }
				
				if(args.length < 1){
					console.log("message for server message missing");
					gc.send(from, "!message for server message missing!");
					return;
				}

			
				var connectedUsers = users.filter(function(user){
					return user.account.active;
				});
				
				var total = connectedUsers.length;
				var quit = 0;
				
				var serverMsg = "!server msg: " + args.join(' ') + "!";

				connectedUsers.map(function(user){
					gc.send(user.account.xmppAddress[user.account.xmppAddress.length-1], serverMsg);
				});
			
				return;
				
			case "nobold":
				authUser.account['nobold'] = !authUser.account.hasOwnProperty('nobold') || !authUser.account['nobold'];
				gc.send(from, "!nobald switched to " + authUser.account['nobold'] + "!");
				
				saveAccounts();
				
				return;
				
			case "suffix":
			
				if(args.length < 1){
					console.log("suffix required");
					gc.send(from, "!error: suffix required!");
					return;
				}
				
				var suffix = args[0].replace(/[^A-Za-z_|0-9]*/g, '');
				
				if(suffix.length < 1){
					console.log("suffix contained no legal characters");
					gc.send(from, "!error: suffix contained no legal characters (A-Za-z0-9_|)!");
					return;
				}
				
				authUser.account.nick = authUser.account.id + "|" + suffix;
				
				saveAccounts();
				
				authUser.ircc.changeNick( authUser.account.nick  );
				
				gc.send(from, "!nick changed to " + authUser.account.nick + "!");
				
				return;
				
            case "deauth":
                authUser.account.xmppAddress = authUser.account.xmppAddress.filter(function(xmpp){return xmpp != from;});
                gc.send(from, "!deauth success!");

                saveAccounts();

                return;
            
			case "names":
                
				var nickList = authUser.ircc.getNames().reduce(
					function(p, c){
						return '' + p + ', ' + c;
					}
				,'').substr(1);
				
				gc.send(from, "!users : " + nickList + "!");

                return;
				
            case "me":
                gc.send(from, "!authed as : " + authUser.account.id + "!");

                return;

            case "on":

                if(!authUser.account.active){
                    authUser.account.active = true;
                    connectAccount(authUser);
					saveAccounts(function(err){
							if(!!err){
								console.log("error saving accounts file " + err);
								return;
							}
							console.log("saved accounts file");							
						});
                }

                return;

            case "off":

                if(authUser.account.active){
                    disconnectAccount(authUser, function(){
                        authUser.account.active = false;
					    saveAccounts(function(err){
							if(!!err){
								console.log("error saving accounts file " + err);
								return;
							}
							console.log("saved accounts file");							
						});
                    });
                }

                return;

            case "backup":

                if(!authUser.account.permissions.admin){
                    console.log("unauthorized attempt to save by " + authUser.account.id);
                    gc.send(from, "!this account is not authorized for that action!");
                    return;
                }

                saveAccounts(function(err){
                    if(!!err){
                        console.log("error saving accounts file " + err);
                        gc.send(from, "!error saving accounts file " + err+ "!");
                        return;
                    }
                    console.log("saved accounts file");
                    gc.send(from, "!saved accounts file!");
                });

                return;

            case "adduser":

                if(!authUser.account.permissions.admin){
                    console.log("unauthorized attempt to add user by " + authUser.account.id);
                    gc.send(from, "!this account is not authorized for that action!");
                    return;
                }

                if(args.length < 2){
                    console.log("not enough params to add user");
                    gc.send(from, "!not enough params to add user (user, secret)!");
                    return;
                }

                var newUser = {
                    "account": {
                        "id":args[0],
                        "active":false,
                        "blocked":false,
                        "nick":args[0] + "|proxy",
                        "xmppAddress":[],
                        "connectingSecret":args[1],
                        "permissions":{}},

                    "connected":false,
                    "ircc":null
                };

                users.push(newUser);

                console.log("added user" + args[0]);
                gc.send(from, "!added user " + args[0] + "!");

                saveAccounts();

                return;


            case "removeuser":

                if(!authUser.account.permissions.admin){
                    console.log("unauthorized attempt to remove user by " + authUser.account.id);
                    gc.send(from, "!this account is not authorized for that action!");
                    return;
                }

                if(args.length < 1){
                    console.log("not enough params to remove user");
                    gc.send(from, "!not enough params to add user!");
                    return;
                }

                for(var i = 0; i < users.length; i++){
                    if(users[i].account.id == args[0]){
                        users.splice(i, 1);

                        console.log("removed user" + args[0]);
                        gc.send(from, "!removed user " + args[0] + "!");

                        saveAccounts();
                        return;
                    }
                }

                console.log("could not find user " + args[0]);
                gc.send(from, "!could not find user " + args[0] + "!");

                return;

        }

        console.log("command not found: " + command + ", given by user " + authUser.account.id);
        gc.send(from, "!command not found: " + command + "!");
        return;
    }

    if(authUser.account.active && authUser.connected)
    {
        authUser.ircc.send(message);
    }

});

var exiting = false;
process.on('SIGINT', function () {
    if(!exiting) {
        exiting = true;
        console.log("Caught interrupt signal");
        quitAll();
    }else{
        console.log("ignoring repeated interrupt signal, please wait for timeout")
    }
});