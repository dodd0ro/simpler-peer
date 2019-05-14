import uuid4 from 'uuid/v4';

const Peer = require('simple-peer');
const channelFlag = '3e74290e-cfda-4fef-b412-d86f949caf03';

export default class SimplerPeer {
	constructor(iceServers, signalEventName) {
		this.signalEventName = signalEventName || 'rtc';

		this.uid = null;

		this.peers = {};
		this.signals = {};

		this._events = {};
		this._channels = {};

		this._chanks = {};

		this.iceServers = iceServers;
		this.stream = null;

		this.handleSignal = this._handleSignal.bind(this);
		this._dispatchEvent = this._dispatchEvent.bind(this);
		this._dispatchChannelEvent = this._dispatchChannelEvent.bind(this);
	}

	setMyUid(uid) {
		this.uid = uid;
	}

	async connect(otherUid) {
		if (typeof otherUid != 'string') throw 'otherUid mast be a string!';

		if (this.iceServers && this.iceServers.constructor.name === 'Promise') {
			this.iceServers = await this.iceServers;
			console.log('iceServers', this.iceServers);
		}

		console.log('TRY TO CONNECT', otherUid);

		var peer = this.peers[otherUid];
		var signal = this.signals[otherUid];

		if (signal) {
			if (!peer) {
				peer = this._initPeer(otherUid, false);
			}
			peer.signal(this.signals[otherUid]);
			delete this.signals[otherUid];
		} else if (peer) {
			return;
		} else {
			this._initPeer(otherUid, true);
		}
	}

	disconnect(otherUid) {
		let peer = this.peers[otherUid];
		if (!peer) throw 'Uid does not exist!';
		peer.destroy();
		delete this.peers[otherUid];
		delete this.signals[otherUid];
	}

	send(data, otherUids = null) {
		if (!Array.isArray(otherUids)) {
			if (otherUids) {
				otherUids = [ otherUids ];
			} else {
				otherUids = Object.keys(this.peers);
			}
		}

		let chanks = createChanks(data);
		// console.log('SENDING ' + chanks.length + ' CHANKS!')
		for (let chank of chanks) {
			for (let uid of otherUids) {
				let peer = this.peers[uid];
				if (!peer) throw 'Uid does not exist!';
				peer.send(chank);
			}
		}
	}

	sendTo(channel, data, otherUids = null) {
		data = {
			channel: channel,
			data: data,
			channelFlag: channelFlag
		};

		this.send(data, otherUids);
	}

	// addStream(otherUid, stream) {
	//   this.stream = stream;

	//   let peer = this.peers[otherUid];
	//   if (!peer) throw 'Uid does not exist!';
	//   console.log('adding stream to', otherUid);
	//   peer.addStream(this.stream);
	// }

	addStream(stream) {
		this.stream = stream;
		for (let uid in this.peers) {
			let peer = this.peers[uid];
			if (peer.connected) {
				console.log('adding stream to', uid);
				peer.addStream(stream);
			}
		}
	}

	// removeStream(otherUid) {
	//   if (!this.stream) return;

	//   let peer = this.peers[otherUid];
	//   if (!peer) throw 'Uid does not exist!';
	//   console.log('removing stream from', otherUid);
	//   peer.removeStream(this.stream);
	// }

	removeStream() {
		for (let uid in this.peers) {
			let peer = this.peers[uid];
			if (peer.connected) {
				console.log('removing stream from', uid);
				peer.removeStream(this.stream);
			}
		}
		this.stream = null;
	}

	_initPeer(otherUid, isInitiator) {
		var self = this;

		const peer = (this.peers[otherUid] = new Peer({
			initiator: isInitiator,
			trickle: false, //?
			reconnectTimer: 3000, //QUEST
			stream: this.stream || false,
			offerConstraints: {
				//?
				offerToReceiveVideo: true,
				offerToReceiveAudio: true
			},
			config: {
				// iceTransportPolicy: "relay",
				iceServers: this.iceServers
			}
		}));
		console.log('PEER!!!!!!', peer);

		peer.on('error', (error) => console.log('!RTC ERROR: ', error));

		peer.on('signal', this._sendSignal.bind(this, otherUid));

		for (let event of [ 'close', 'connect', 'stream' ]) {
			peer.on(event, function(data) {
				let response = {};
				response.uid = otherUid;
				response.peer = this;
				if (data) response.data = data;

				self._dispatchEvent(event, response);
			});
		}

		peer.on('data', function(data) {
			var { uuid, index, length, data } = decodeChank(data.buffer);
			let chanks =
				self._chanks[uuid] ||
				(self._chanks[uuid] = { count: 0, sequence: [] });
			chanks.sequence[index] = data;
			chanks.count++;

			if (chanks.count === length) {
				data = bakeChanksData(chanks.sequence);
				// console.log(length + ' CHANKS BAKED!')

				let response = {};
				response.uid = otherUid;
				response.peer = this;

				if (data.channelFlag == channelFlag) {
					response.data = data.data;
					self._dispatchChannelEvent(data.channel, response);
				} else {
					if (data) response.data = data;
					self._dispatchEvent('data', response);
				}
			}
		});

		return peer;
	}

	_sendSignal(otherUid, mySignal) {
		console.log('SENDING', mySignal, otherUid);

		this._dispatchEvent('signal', {
			fromUid: this.uid,
			toUid: otherUid,
			signal: mySignal
		});
	}

	_handleSignal(response) {
		let { toUid, fromUid, signal } = response;

		console.log('GOT', signal, fromUid);

		if (toUid != this.uid) return;

		if (signal.type == 'offer') {
			if (fromUid in this.peers) {
				//?bad

				console.log('RECONNECT offer');
				this.peers[fromUid].signal(signal);
			} else {
				this.signals[fromUid] = signal;
				this._dispatchEvent('offer', { uid: fromUid });
			}
		} else if (signal.type == 'answer') {
			this.peers[fromUid].signal(signal);
			console.log(
				'SIGNALING ANSWER',
				fromUid,
				this.peers[fromUid],
				signal
			);

			this._dispatchEvent('answer', { uid: fromUid });
		} else if (signal.renegotiate == true) {
			if (fromUid in this.peers) {
				console.log('RECONNECT preoffer');
				this.peers[fromUid].signal(signal);
			}
		}
	}

	on(name, callback) {
		let event = this._events[name] || (this._events[name] = []);
		event.push(callback);
	}

	_dispatchEvent(name, data) {
		let event = this._events[name];
		if (!event) return;

		for (let callback of event) {
			callback(data);
		}
	}

	onChannel(name, callback) {
		let channel = this._channels[name] || (this._channels[name] = []);
		channel.push(callback);
	}

	_dispatchChannelEvent(name, data) {
		let channel = this._channels[name];
		if (!channel) return;

		for (let callback of channel) {
			callback(data);
		}
	}
}

//================================================

const DESIRED_CHANK_LENGTH_8 = 16000; // 16000;
const infoLengths8 = [ 16, 2, 2 ];
const infoIndexes16 = [ 0, 8, 9, 10 ];

const infoLength8 = infoLengths8.reduce((a, v) => a + v);
const infoLength16 = infoLength8 / 2;
var maxStrLength = Math.floor((DESIRED_CHANK_LENGTH_8 - infoLength8) / 2);

function createChanks(data) {
	const chanks = [];
	var str = JSON.stringify(data);

	var chanksNum = Math.ceil(str.length / maxStrLength);
	var uuid16 = new Uint16Array(uuid4(null, new Uint8Array(16), 0).buffer);

	for (let n = 0, i = 0; n < chanksNum; n++, i += maxStrLength) {
		let subString = str.substr(i, maxStrLength);
		var buf16View = new Uint16Array(infoLength16 + subString.length);

		buf16View.set(uuid16, infoIndexes16[0]);
		buf16View.set([ n ], infoIndexes16[1]);
		buf16View.set([ chanksNum ], infoIndexes16[2]);
		for (
			let i = 0, bi = infoIndexes16[3];
			i < subString.length;
			i++, bi++
		) {
			buf16View[bi] = subString.charCodeAt(i);
		}

		chanks.push(buf16View.buffer);
	}
	return chanks;
}

function decodeChank(buf) {
	var buf16View = new Uint16Array(buf);
	return {
		uuid: bufferToHex(
			buf16View.slice(infoIndexes16[0], infoIndexes16[1]).buffer
		),
		index: buf16View[infoIndexes16[1]],
		length: buf16View[infoIndexes16[2]],
		data: buf16View.slice(infoIndexes16[3]).buffer
	};
}

function bakeChanksData(buffersSequence) {
	let firstBuf8View = new Uint8Array(buffersSequence[0]);
	let lastBuf8View = new Uint8Array(
		buffersSequence[buffersSequence.length - 1]
	);
	const buf8Len =
		firstBuf8View.length * (buffersSequence.length - 1) +
		lastBuf8View.length;
	const resBuf8View = new Uint8Array(buf8Len);
	var lastIndex = 0;
	for (let buf of buffersSequence) {
		let buf8View = new Uint8Array(buf);
		resBuf8View.set(buf8View, lastIndex);
		lastIndex += buf8View.length;
	}
	return JSON.parse(convertArrayBufferToString(resBuf8View.buffer));
}

///

function bufferToHex(buf) {
	var buf8View = new Uint8Array(buf);
	var hex = '';
	buf8View.forEach((n) => (hex += n.toString(16)));
	return hex;
}

function convertArrayBufferToString(buf) {
	var str = '';
	var array16 = new Uint16Array(buf);
	for (let i = 0; i < array16.length; i++) {
		str += String.fromCharCode(array16[i]);
	}
	return str;
}

///
