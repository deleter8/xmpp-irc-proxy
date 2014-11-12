var xmpp = require('node-xmpp');
var util = require('util');

var GChat = function(username, password) {
    var self = this;
    var connected = false;
    var client = null;
    var messages = [];
    var reconnectEvent = null;
    var presencePingEvent = null;
    var initReconnectWait = 5;
    var reconnectWait = initReconnectWait;
    var maxReconnectWait = 15 * 60;
    var reconnecting = false;
    var quitting = false;

    var creds = {
        "jid": username,
        "password": password,
        "reconnect ":true
    };

    this.handlers = {"connected":[], "message":[], "disconnected":[]};

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

    this.send = function (to, message) {
        var stanza = new xmpp.Element('message', {"to": to, "type": 'chat' }).c('body').t(message);
        if(connected) {
            try {
                client.send(stanza);
            }catch(err){
                console.log("error detected while trying to send message ", err);
                messages.push(message);
            }
        }else{
            messages.push(message);
        }
    };

    this.end = function () {
        quitting = true;
        client.end();
    };

    var sendBacklog = function(){
        console.log("sending backlog...");
        var message = messages.pop();
        client.send(message);
        if(messages.length > 0){
            setTimeout(sendBacklog, 10);
        }
    };

    var reconnect = function(){
        if(quitting) return;
        if(!!reconnectEvent){
            console.log("not reconnecting because reconnect is already pending");
            return;
        }

        reconnecting = true;

        console.log("xmpp reconnecting...");
        connected = false;
        if(client != null) {
            invokeHandlers("disconnected");
            try {
                client.end();
            } catch (err) {
                console.log("err " + err + " when trying to client.end / removealllisteners");
            }
            client = null;
            self.client = null;
        }

        reconnectEvent = setTimeout(init, reconnectWait * 1000);
        reconnectWait += 5;
        if(reconnectWait > maxReconnectWait) reconnectWait = maxReconnectWait;
    };

    var presencePing = function(){
        if(presencePingEvent){
            clearTimeout(presencePingEvent);
        }
        if(connected) client.send(new xmpp.Element('presence'));

        presencePingEvent = setTimeout(presencePing, 5 * 60 * 1000);
    };

    var init = function() {
        console.log("logging into " + creds.jid);
        client = self.client = new xmpp.Client(creds);
        console.log("xmpp connecting...");
        reconnectEvent = null;

        client.on('online', function () {
            reconnecting = false;
            console.log("xmpp connection online");
            client.send(new xmpp.Element('presence'));
            connected = true;
            reconnectWait = initReconnectWait;
            invokeHandlers('connected');
            //if(!!reconnectEvent){
            //    clearTimeout(reconnectEvent);
            //}
            //reconnectEvent = setTimeout(reconnect, 15 * 60 * 1000);//hack to reconnect every 15 cuz its broken

            if(messages.length > 0){
                setTimeout(sendBacklog, 0);
            }

            if(presencePingEvent){
                clearTimeout(presencePingEvent);
            }
            presencePingEvent = setTimeout(presencePing, 5 * 60 * 1000);

        });

        client.connection.socket.setTimeout(0);
        client.connection.socket.setKeepAlive(true, 10000);

        client.on('stanza', function (stanza) {
            //util.log('IN: '+stanza.name);
            if (stanza.is('presence')) client.emit('presence', stanza);
            else if (stanza.is('message')) client.emit('message', stanza);
        });

        client.on('presence', function (p) {
            var show = p.getChild('show');

            util.print('Friend: ' + p.attrs.from);

            if (show) util.print(' (' + show.getText() + ')');
            util.print('\n');
        });

        client.on('message', function (msg) {
            var from = msg.attrs.from;
            var body = msg.getChild('body');
            var text = body ? body.getText() : '';
            var type = msg.attrs.type;

            if ("error" == type) {
                console.log("chat msg type was error");
                return;
            }
            try {
                util.print("dump = " + JSON.stringify(msg));
            } catch (err) {
                util.print("dump2 = " + msg.toString());
            }

            try {
                util.print("dumpattrs = " + JSON.stringify(msg.attrs));
            } catch (err) {
                util.print("dumpattrs2 = " + msg.attrs.toString());
            }

            util.print('\nNew message from: ' + from + '\n');
            util.print('\t' + text + '\n');

            if (text) {
                invokeHandlers('message', from, text);
            }
        });

        client.on('error', function(e) {
            console.log("error in xmpp: ",e);
            if (e.code == 'ECONNRESET') {
                reconnect();
            }else{
				throw new Error("failure in xmpp code");
			}
        });

        client.on('offline', function() {
            if(!reconnecting) {
                console.log("xmpp went offline ");
                reconnect();
            }else{
                console.log("xmpp offline detected while reconnecting...")
            }
        });
    };

    setTimeout(init, 0);
};

module.exports = GChat;