const rp = require('request-promise');
const fs = require('fs');
const csv = require('fast-csv');
const { Readable } = require('stream');
const through2 = require('through2');
const moment = require('moment');
const MidiWriter = require('midi-writer-js');
const program = require('commander');

const COUNTRY = "Country/Region"

const config = {
	days: 120,
	hours: 48,
	divisor: 64,
	duration: '8',
	confirmedUrl: 'https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/time_series_covid19_confirmed_global.csv',
	confirmedInstrument: 1,
	deathsUrl: 'https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/time_series_covid19_deaths_global.csv',
	deathsInstrument: 9,
	input: './notes.csv',
	output: 'output.mid'
};

const remoteFile = async url => {
	let result
	try {
		result = await rp(url)
	} catch(e) {
		console.log(e);
	}
	return result
}

const remoteFileStream = async (url) => {
	const response = await remoteFile(url)
	const stream = new Readable();
	stream._read = () => {};
	stream.push(response);
	stream.push(null);
	return stream; 
}

const wholeCSV = async (stream) => {
	const whole = [];
	return new Promise((resolve, reject) =>{
		stream
			.pipe(csv.parse({ headers: true }))
			.on('error', error => reject())
		    .on('data', row => whole.push(row))
			.on('end', () => resolve(whole));
	});
}

const remoteWholeCSV = async (url) => await wholeCSV(await remoteFileStream(url));
const localWholeCSV = async (uri) => await wholeCSV(fs.createReadStream(uri));

const toMidiTrack = (data, name, instrument) => {
	const {days, hours, divisor, duration} = config;
	const missing = [];
	const instants = [];
	Array(days).fill().map((day, dayNumber) => {
		instants.push(...Array(hours).fill().map((hour, hourNumber) => {
			return data.map(row => {
				const country = row[COUNTRY];
				const dayCount = parseInt(row[dayNumber]) || 0;
				const count = Math.round(dayCount / divisor);
				if (dayNumber in row && count > hourNumber > 0) {
					if (!row.note && !missing.includes(country)) {
						missing.push(country);
					}
					if (row.note) {
						console.log(`pitch ${dayNumber}:${hourNumber} -> ${count}/${count - hourNumber} ${country} ${row.note}`);
						return row.note
					}
				}
			}).filter(it => it);
		}));
	});
	const events = instants.filter(it => it.length > 0).map((notes, epoch) => {
		console.log(`exporting epoch ${epoch} ${notes.length}`);
		return new MidiWriter.NoteEvent({pitch:notes, duration: duration});
	});
	const track = new MidiWriter.Track();
	track.addTrackName(name);
	track.addEvent(new MidiWriter.ProgramChangeEvent({instrument: instrument || 1 }));
	track.addEvent(events, (event, index) => {sequential: false});
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
		if (row[COUNTRY] == name) {
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
	arr = arr.filter(row => row[COUNTRY] != name);
	arr.push[region];
	return arr;
}

const transformDates = (notes, row) => {
	const match = notes.find(item => item.country == row[COUNTRY]);
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

const transformArray = (notes, arr) => sumRegions('China', arr).map(row => transformDates(notes, row));

(async () => {
	const {confirmedUrl, deathsUrl, confirmedInstrument, deathsInstrument, output, input} = config;
	const notes = await localWholeCSV(input);
	const confirmed = await remoteWholeCSV(confirmedUrl);
	const deaths = await remoteWholeCSV(deathsUrl);
	console.log("confirmed " + confirmed);
	console.log("deaths " + deaths);
	const deathsTrack = toMidiTrack(transformArray(notes, deaths), 'Deaths', deathsInstrument);
	const confirmedTrack = toMidiTrack(transformArray(notes, confirmed), 'Confirmed', confirmedInstrument);
	writeTrack([confirmedTrack], output);
})()

/*program
    .arguments('[midi]')
	.option('-i, --input <input>', 'Input File')
    .option('-o, --output <output>', 'Output File')
    .action((midi) => {
		  
    })
    .parse(process.argv);*/



