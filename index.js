const rp = require('request-promise');
const fs = require('fs');
const csv = require('fast-csv');
const { Readable } = require('stream');
const through2 = require('through2');
const moment = require('moment');
const MidiWriter = require('midi-writer-js');

const notes = './notes.csv';
const url = 'https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/time_series_covid19_confirmed_global.csv';

const remoteFile = url => rp(url).catch(err => console.log(err));
const remoteFileStream = (url, done) => remoteFile(url)
	.then(response => {
		//console.log("response" + response);
		const stream = new Readable();
		done(stream);
		stream._read = () => {};
		stream.push(response);
		stream.push(null); 
		//stream.pipe(csv.parse({ headers: true }));
	});

const wholeCSV = (stream, done) => {
	const whole = [];
	stream
		.pipe(csv.parse({ headers: true }))
		.on('error', error => console.log(error))
	    .on('data', row => whole.push(row))
		.on('end', () => done(whole));
}

const remoteWholeCSV = (url, done) => remoteFileStream(url, stream => wholeCSV(stream, done));

const localWholeCSV = (uri, done) => wholeCSV(fs.createReadStream(uri), done);

const toMidiTrack = data => {
	const track = new MidiWriter.Track();
	const missing = [];
	Array(90).fill().map((_, i) => {
		console.log("epoch " + i);
		Array(16).fill().map((_, ii) => {
			console.log("time " + ii);
			const notes = [];
			data.forEach((row, j) => {
				const count = Math.round(parseInt(row[i]) / 64) || 0;
				if (i in row && count > 0) {
					//console.log(`cases ${row['Country/Region']} @${count} vs ${ii}`);
					if (count > ii) {
						if (row.note == undefined && missing.indexOf(row['Country/Region'])==-1) missing.push(row['Country/Region']);
						if (row.note) {
							console.log(`midi note event pitch ${i}:${ii} -> ${count}/${count - ii} ${row['Country/Region']} ${row.note}`);
							notes.push(row.note);
							//notes.push(new MidiWriter.NoteEvent({pitch:[`${row.note}`], duration: '8'}));
						}
					}
				}
			});
			if (notes.length > 0) {
				console.log(`exporting epoch ${i} ${notes.length}`);
				const event = new MidiWriter.NoteEvent({pitch:notes, duration: '16'});
				track.addEvent([event], (event, index) => {sequential: false});
			}
		});
	});
	//console.log("missing");
	//console.log(missing);
	return track;
};

const writeTrack = (track, file) => {
	const stream = fs.createWriteStream(file);
	const write = new MidiWriter.Writer(track);
	//console.log(write.buildFile());
	fs.writeFile(file, write.base64(), 'base64', err => {
		console.log(err);
	});
};

localWholeCSV(notes, allNotes => {
	remoteWholeCSV(url, allData => {
		const xChina = {
			"Province/State": null,
			"Country/Region": 'XChina',
			"Lat": null,
			"Long": null	
		};
		allData.forEach(row => {
			if (row['Country/Region'] == "China") {
				Object.keys(row).forEach((key, i) => {
					if (!isNaN(row[key])) {
						if (!(key in xChina)) {
							xChina[key] = parseInt(row[key]);
						} else {
							xChina[key] = xChina[key] +parseInt(row[key]);
						}
					}
				});
			}
		});
		allData.push[xChina];
		const post = allData.map(row => {
			const match = allNotes.find(item => item.country == row['Country/Region']);
			if (match) row.note = match.note;
			const start = moment('1/22/20', 'MM/DD/YY');
			Object.keys(row).forEach((key, i) => {
				const re = /^(0?[1-9]|1[012])[\/\-](0?[1-9]|[12][0-9]|3[01])[\/\-]\d{2}$/
				if (key.match(re)) {
					const date = moment(key, 'MM/DD/YY');
					const delta = date.diff(start, 'days');
					const val = row[key];
					delete row[key];
					row[delta] = val;
				}
			});
			return row;
		});
		const track = toMidiTrack(post);
		writeTrack(track, 'ouput.mid');
		
	});
});

