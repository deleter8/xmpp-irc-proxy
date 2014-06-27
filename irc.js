var irc = require('irc');

function IrcClient(server, channel, username) {

    var self = this;
    var connected = false;
    var client = null;
    var messages = [];

    this.handlers = {"connected":[], "message":[], "pm":[], "action":[]};

    var invokeHandlers = function(topic){
        var args = Array.prototype.slice.call(arguments, 1);
        setTimeout(function(){
            for(var i = 0; i < self.handlers[topic].length; i++){
                self.handlers[topic][i].apply(null, args);
            }
        }, 0);
    };

    this.addListener = function(topic, fn){
        if(self.handlers.hasOwnProperty(topic)){
            self.handlers[topic].push(fn);
        }else{
            throw new Error("no such topic: " + topic);
        }
    };

    this.removeListener = function(topic, fn){
        if(self.handlers.hasOwnProperty(topic)){
            var index = self.handlers[topic].indexOf(fn);
            if (index > -1) {
                self.handlers[topic].splice(index, 1);
            }
        }else{
            throw new Error("no such topic: " + topic);
        }
    };

    this.send = function (message) {
        if(connected) {
            if (message.indexOf('/me ') == 0) {
                client.action(channel, message.slice(4));
                return;
            }
            client.say(channel, message);
        }else{
            messages.push(message);
        }
    };

    this.sendpm = function(nick, message){
        client.say(nick, message);
    };

    this.end = function (fn) {
        client.disconnect('leaving', fn);
    };

    var reconnect = function(){
        connected = false;
        self.end(function(){
            client.removeAllListeners();
            client = null;
            setTimeout(init, 0);
        });
    };

    var sendBacklog = function(){
        if(messages.length > 0){
            var message = messages.pop();
            self.send(message);
            setTimeout(sendBacklog, 10);
        }
    };


    var init = function() {
        var name = process.env['PROXY_USERNAME'] || 'chat';
        client = new irc.Client(server, username, {
            userName: 'proxy',
            realName: ' IRC proxy bot',
            channels: [channel]
        });

        client.addListener('message', function (from, to, message) {
            console.log(from + ' => ' + to + ': ' + message);
            invokeHandlers('message', from, message);
        });

        client.addListener('registered', function (message) {
            try {
                console.log('registered : ' + JSON.stringify(message));
            } catch (err) {
                console.log('registered : ' + message.toString());
            }
        });

        client.addListener('join', function (channel, nick, message) {
            try {
                console.log(nick + ' joined ' + channel + ' : ' + JSON.stringify(message));
            } catch (err) {
                console.log(nick + ' joined ' + channel + ' : ' + message.toString());
            }
            if (nick == username) {
                connected = true;
                invokeHandlers('connected');
                setTimeout(sendBacklog,0);
                //now enabled for sending/receiving messages
            }
        });

        client.addListener('pm', function (from, message) {
            console.log(from + ' => ME: ' + message);
            invokeHandlers('pm', from, message);
        });

        client.addListener('error', function (message) {
            console.log('error: ', message);
            console.log("reconnecting");
            reconnect();
        });

        client.addListener('quit', function (nick, reason, channels, message) {
            console.log(nick + 'left because ' + reason + ', message was ' + message);
        });

        client.addListener('raw', function (message) {
            //todo: do log some of this / handle some of it, its only commented out to clear console spam
//            try {
//                console.log('raw : ' + JSON.stringify(message));
//            } catch (err) {
//                console.log('raw2 : ' + message.toString());
//            }
            //todo: id action message and fw it

            //console.log("command = " + message.command + ", nick = " + message.nick);

            if(message.command == "PRIVMSG" && message.args[1].indexOf('\u0001ACTION')==0){
                var text = message.args[1].replace('\u0001ACTION ', '').replace('\u0001', '');
                invokeHandlers('action', message.nick, text);
            }

            if(message.command == "JOIN" && message.nick == username){
                invokeHandlers('connected');
            }
        });
    };

    setTimeout(init, 0);
}

module.exports = IrcClient;