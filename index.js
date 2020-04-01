const rp = require('request-promise');
const fs = require('fs');
const csv = require('fast-csv');
const { Readable } = require('stream');
const through2 = require('through2');
const moment = require('moment');
const MidiWriter = require('midi-writer-js');

const notes = './notes.csv';
const confirmedUrl = 'https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/time_series_covid19_confirmed_global.csv';
const deathsUrl = 'https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/time_series_covid19_deaths_global.csv'

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

const toMidiTrack = (data, name, instrument) => {
	const days = 90;
	const hours = 24; //before 16;
	const divisor = 64;
	const duration = '16';
	const track = new MidiWriter.Track();
	track.addTrackName(name);
	track.addEvent(new MidiWriter.ProgramChangeEvent({instrument: instrument || 1}));
	const missing = [];
	Array(days).fill().map((_, i) => {
		Array(hours).fill().map((_, ii) => {
			const notes = [];
			data.forEach((row, j) => {
				const count = Math.round(parseInt(row[i]) / divisor) || 0;
				if (i in row && count > 0) {
					if (count > ii) {
						if (row.note == undefined && missing.indexOf(row['Country/Region'])==-1) missing.push(row['Country/Region']);
						if (row.note) {
							console.log(`midi note event pitch ${i}:${ii} -> ${count}/${count - ii} ${row['Country/Region']} ${row.note}`);
							notes.push(row.note);
						}
					}
				}
			});
			if (notes.length > 0) {
				console.log(`exporting epoch ${i} ${notes.length}`);
				const event = new MidiWriter.NoteEvent({pitch:notes, duration: duration});
				track.addEvent([event], (event, index) => {sequential: false});
			}
		});
	});
	return track;
};

const writeTrack = (tracks, file) => {
	const stream = fs.createWriteStream(file);
	const write = new MidiWriter.Writer(tracks);
	fs.writeFile(file, write.base64(), 'base64', err => console.log(err || "Done!"));
};

const sumRegions = (name, arr) => {
	const region = {
		"Province/State": null, "Country/Region": name, "Lat": null, "Long": null	
	};
	arr.forEach(row => {
		if (row['Country/Region'] == name) {
			Object.keys(row).forEach((key, i) => {
				if (!isNaN(row[key])) {
					if (!(key in region)) {
						region[key] = parseInt(row[key]);
					} else {
						region[key] = region[key] +parseInt(row[key]);
					}
				}
			});
		}
	});
	arr = arr.filter(row => row['Country/Region'] != name);
	arr.push[region];
	return arr;
}

const transformDates = (notes, row) => {
	const match = notes.find(item => item.country == row['Country/Region']);
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
};

const transformArray = (notes, arr) => {
	return sumRegions('China', arr).map(row => transformDates(notes, row));
};

localWholeCSV(notes, notes => {
	remoteWholeCSV(confirmedUrl, confirmed => {
		const confirmedTrack = toMidiTrack(transformArray(notes, confirmed), 'Confirmed Cases', 1);
		writeTrack([confirmedTrack], 'output.mid');
	});
});

