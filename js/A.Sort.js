/*!
 * Project: Audio Sort
 *    File: A.Sort.js
 *  Source: https://github.com/skratchdot/audio-sort/
 *
 * Copyright (c) 2013 skratchdot
 * Licensed under the MIT license.
 */
/*global $, sc, ace, d3, js_beautify, timbre, A, Worker, Blob, Uint8Array, saveAs */
(function (global) {
	'use strict';

	var Sort = {},
		// Pass jshint
		Fn = Function,
		// Default Settings
		defaults = {
			volume: { value: 0.25, min: 0, max: 1, step: 0.01 },
			tempo: { value: 90, min: 20, max: 300, step: 1 },
			centerNote: { value: 69, min: 0, max: 127, step: 1 },
			scale: { value: 'chromatic' },
			sort: { value: 'bubble' },
			dataSize: { value: 12, min: 4, max: 48, step: 1 },
			audioType: { value: 'waveform' },
			waveform: { value: 'string' },
			soundfont: { value: 0 }
		},
		// Currently Selected Items
		selected = {
			volume: defaults.volume.value,
			tempo: defaults.tempo.value,
			centerNote: defaults.centerNote.value,
			scale: defaults.scale.value,
			sort: defaults.sort.value,
			dataSize: defaults.dataSize.value,
			audioType: defaults.audioType.value,
			waveform: defaults.waveform.value,
			soundfont: defaults.soundfont.value
		},
		// Waveform Data
		waveform = {
			'string': { gen: 'PluckGen', poly: 10, mul: 1, a: 50, d: 300, s: 0.5, h: 500, r: 2500 },
			'sin':    { gen: 'OscGen', poly: 10, mul: 1, a: 50, d: 300, s: 0.5, h: 200, r: 300 },
			'cos':    { gen: 'OscGen', poly: 10, mul: 1, a: 50, d: 300, s: 0.5, h: 200, r: 300 },
			'pulse':  { gen: 'OscGen', poly: 10, mul: 0.25, a: 50, d: 300, s: 0.5, h: 200, r: 300 },
			'tri':    { gen: 'OscGen', poly: 10, mul: 1, a: 50, d: 300, s: 0.5, h: 200, r: 300 },
			'saw':    { gen: 'OscGen', poly: 10, mul: 0.25, a: 50, d: 300, s: 0.5, h: 200, r: 300 },
			'fami':   { gen: 'OscGen', poly: 10, mul: 1, a: 50, d: 300, s: 0.5, h: 200, r: 300 },
			'konami': { gen: 'OscGen', poly: 10, mul: 0.4, a: 50, d: 300, s: 0.5, h: 200, r: 300 }
		},
		waveformSliders = {},
		// Audio players
		players = {
			base: null,
			sort: null
		},
		// Audio Variables
		env,
		pluck,
		// Ace Editor
		aceEditor,
		// AutoPlay
		$sortAutoPlay,
		triggerAutoPlay = false,
		// Helper Variables
		displayCache = {},
		baseData = [],
		maxData = [],
		// Prevent clicks from spawing too many web workers
		clickTimer = null,
		clickDelay = 250,
		// Web Workers
		worker = null,
		workerKey,
		workerUrl = 'dist/worker.min.js',
		workerOnMessage,
		workerOnError,
		// Functions
		addAceEditor,
		populateWaveformButtons,
		updateWaveformDisplays,
		setSliderWaveformFromSelected,
		onAudioTypeButtonClick,
		onAudioTypeTabLinkClick,
		onSaveAlgorithmEdit,
		onSaveAlgorithmNew,
		onOptionBoxFilter,
		buildSortOptions,
		clickPlayButton,
		doSort,
		generateData,
		getScale,
		getBaseDataAsFrames,
		getBaseDataAsPlayableObjects,
		getNoteName,
		getSortedScaleNames,
		onAudioDataButton,
		onSlider,
		onSliderCenterNote,
		onSliderDataSize,
		onSliderTempo,
		onSliderVolume,
		onSliderWaveform,
		onWaveformButtonClick,
		onSortOptionSelected,
		onMidiExportClick,
		onMidiSave,
		onSortModalClick,
		onSortVisualizationButton,
		onAddAlgorithmModalClick,
		playerButtonCallback,
		populateScaleOptions,
		populateSoundfontOptions,
		preloadSoundfonts,
		setupPlayers,
		updateDisplayCache;

	buildSortOptions = function (selector) {
		var $container, $li, $a, sortKey, sortObject;
		if (global.hasOwnProperty('sort')) {
			$container = $(selector);
			$container.empty();
			for (sortKey in global.sort) {
				if (global.sort.hasOwnProperty(sortKey)) {
					sortObject = global.sort[sortKey];
					$li = $('<li></li>');
					$a = $('<a href="javascript:void(0);"></a>');
					$a.attr('data-sort', sortKey);
					$a.text(sortObject.display);
					$li.append($a);
					$container.append($li);
				}
			}
		}
	};

	populateWaveformButtons = function () {
		var html = '';
		$.each(waveform, function (waveformName) {
			html += $('<button />')
				.addClass('btn btn-mini' + (waveformName === selected.waveform ? ' active' : ''))
				.attr('type', 'button')
				.attr('data-waveform', waveformName)
				.text(waveformName)
				.wrap('<div />').parent().html();
		});
		$('#waveform .btn-group').html(html);
	};

	onWaveformButtonClick = function () {
		var $this = $(this);
		selected.waveform = $this.attr('data-waveform');
		// update slider values
		setSliderWaveformFromSelected();
		// update text on audio tab
		updateDisplayCache('#audio-type-display', 'waveform: ' + selected.waveform);
		// start using new selection
		players.base.refreshWaveGenerator();
		players.sort.refreshWaveGenerator();
		players.base.drawWaveformCanvases();
	};

	getBaseDataAsPlayableObjects = function (playIndex) {
		var i, objectArray = [];
		// convert baseData to an array of drawable/playable objects
		for (i = 0; i < baseData.length; i++) {
			objectArray.push({
				value: baseData[i],
				play: i === playIndex,
				mark: false,
				swap: false,
				justSwapped: false,
				compare: false,
				highlight: false
			});
		}
		return objectArray;
	};

	getBaseDataAsFrames = function () {
		var i, frameArray = [];

		// convert to "frame data"
		for (i = 0; i < baseData.length; i++) {
			frameArray.push({
				arr: getBaseDataAsPlayableObjects(i),
				compareCount: 0,
				swapCount: 0
			});
		}
		return frameArray;
	};

	clickPlayButton = function () {
		$('#sort-player .btn[data-action="play"]').click();
	};

	getNoteName = function (midiNumber) {
		var notes = ['c','c#','d','d#','e','f','f#','g','g#','a','a#','b'],
			len = notes.length,
			octave = Math.floor(midiNumber / len) - 1,
			idx = midiNumber % len,
			note = notes[idx];
		return '(' + note.charAt(0) + octave + note.charAt(1) + ') ' + midiNumber;
	};

	updateDisplayCache = function (selector, value, fnFormat) {
		if (!displayCache.hasOwnProperty(selector)) {
			displayCache[selector] = $(selector);
		}
		if (typeof fnFormat === 'function') {
			value = fnFormat(value);
		}
		displayCache[selector].text(value);
	};

	onAudioTypeButtonClick = function () {
		var $this = $(this),
			$tabs = $('#settings li[data-audio-type]'),
			$tabLink = $('#audio-type-tab-link'),
			audioType = $this.attr('data-audio-type'),
			audioTypeName = $this.text(),
			displayName;
		// set selected type
		selected.audioType = audioType;
		displayName = audioType;
		if (selected.audioType === 'waveform') {
			displayName += ': ' + selected.waveform;
			players.base.refreshWaveGenerator();
			players.sort.refreshWaveGenerator();
		} else if (selected.audioType === 'soundfont') {
			displayName = $('#soundfont-options li.active').text();
		}
		updateDisplayCache('#audio-type-display', displayName);
		// update settings link
		$tabLink.text(audioTypeName.toLowerCase() + ' settings');
		// show correct tab
		$tabs.removeClass('hidden');
		$tabs.filter('[data-audio-type!="' + audioType + '"]').addClass('hidden');
		preloadSoundfonts();
	};

	onAudioTypeTabLinkClick = function () {
		$('#settings li[data-audio-type]:visible a').click();
	};

	onSlider = function (key, selector, event, fnFormat) {
		if (event) {
			selected[key] = event.value;
		}
		updateDisplayCache(selector, selected[key], fnFormat);
	};

	onSliderVolume = function (e) {
		var volume;
		onSlider('volume', '#volume-display', e, function (val) {
			return val.toFixed(2);
		});
		volume = waveform[selected.waveform].mul * selected.volume;
		players.base.setVolume(volume);
		players.sort.setVolume(volume);
	};

	onSliderTempo = function (e) {
		var tempo = Sort.getTempoString();
		onSlider('tempo', '#tempo-display', e);
		players.base.setTempo(tempo);
		players.sort.setTempo(tempo);
	};

	onSliderCenterNote = function (e) {
		onSlider('centerNote', '#center-note-display', e, getNoteName);
		preloadSoundfonts();
	};

	onSliderDataSize = function (e) {
		onSlider('dataSize', '#data-size-display', e);
		generateData(false);
		doSort();
	};

	onSliderWaveform = function (e) {
		var $slider = $(e.target),
			$container = $slider.parents('[data-adshr]:first'),
			adshr = $container.attr('data-adshr');
		waveform[selected.waveform][adshr] = (adshr === 's') ? parseFloat(e.value.toFixed(2)) : e.value;
		updateWaveformDisplays();
		players.base.refreshWaveGenerator();
		players.sort.refreshWaveGenerator();
		players.base.drawEnvelopeCanvas();
	};

	onAudioDataButton = function () {
		var action = $(this).data('action');
		if (global.fn.datagen.hasOwnProperty(action)) {
			generateData(true, action);
			doSort();
		}
	};

	onSortOptionSelected = function () {
		var $item = $(this),
			$parent = $item.parent();
		if ($item.hasClass('disabled')) {
			return;
		}
		$parent.find('li').removeClass('active');
		$item.addClass('active');
		updateDisplayCache('#sort-display', $item.text());
		selected.sort = $item.find('a').data('sort');
		if ($sortAutoPlay.hasClass('active')) {
			triggerAutoPlay = true;
		}
		doSort();
	};

	updateWaveformDisplays = function () {
		updateDisplayCache('#waveform-adshr-attack-display', waveform[selected.waveform].a);
		updateDisplayCache('#waveform-adshr-decay-display', waveform[selected.waveform].d);
		updateDisplayCache('#waveform-adshr-sustain-display', waveform[selected.waveform].s);
		updateDisplayCache('#waveform-adshr-hold-display', waveform[selected.waveform].h);
		updateDisplayCache('#waveform-adshr-release-display', waveform[selected.waveform].r);
	};

	setSliderWaveformFromSelected = function () {
		$.each(['a', 'd', 's', 'h', 'r'], function (index, key) {
			waveformSliders[key].slider('setValue', waveform[selected.waveform][key]);
		});
		updateWaveformDisplays();
	};

	getScale = function (domainMin, domainMax, rangeMin, rangeMax) {
		return d3.scale.linear()
			.domain([domainMin, domainMax])
			.range([rangeMin, rangeMax]);
	};

	generateData = function (regenerateMaxData, action) {
		var i, scale, slice;
		if (regenerateMaxData) {
			if (global.fn.datagen.hasOwnProperty(action)) {
				baseData = global.fn.datagen[action](selected.dataSize);
				maxData = global.fn.datagen[action](defaults.dataSize.max);
				slice = maxData.slice(0, selected.dataSize);
				scale = getScale(
					0,
					baseData.length - 1,
					d3.min(slice),
					d3.max(slice));
				// we always want our current "baseData" when re-sizing
				for (i = 0; i < baseData.length; i++) {
					maxData[i] =  Math.round(scale(baseData[i]));
				}
			}
		} else {
			baseData = maxData.slice(0, selected.dataSize);
			scale = getScale(d3.min(baseData), d3.max(baseData), 0, baseData.length - 1);
			// normalize data
			for (i = 0; i < baseData.length; i++) {
				baseData[i] = Math.round(scale(maxData[i]));
			}
		}
		players.base.setData(getBaseDataAsFrames());
		preloadSoundfonts();
	};

	addAceEditor = function (container) {
		var $container = $(container),
			id = 'id_' + (new Date()).getTime();
		$container.empty().append('<div class="js-editor" id="' + id + '"></div>');
		aceEditor = ace.edit(id);
		aceEditor.setTheme('ace/theme/monokai');
		aceEditor.getSession().setMode('ace/mode/javascript');
		aceEditor.getSession().on('changeAnnotation', function () {
			var i,
				annotation,
				annotationsOld = aceEditor.getSession().getAnnotations(),
				annotationsNew = [],
				changed = false;
			for (i = 0; i < annotationsOld.length; i++) {
				annotation = annotationsOld[i];
				if (annotation.text === "'AS' is not defined.") {
					changed = true;
				} else {
					annotationsNew.push(annotation);
				}
			}
			if (changed) {
				aceEditor.getSession().setAnnotations(annotationsNew);
			}
		});
	};

	onMidiExportClick = function () {
		var $modal = $('#modal-midi-export');

		// setup a default file name
		$('#midi-export-name').attr('placeholder', 'AudioSort_' + (new Date()).getTime()).val('');

		// populate channels
		A.MidiExport.populateChannels('#midi-export-channel');

		// populate instruments
		A.MidiExport.populateInstruments('#midi-export-instrument');

		// store the source of our data so onMidiSave() can use it
		$('#midi-export-btn').attr('data-midi-export', $(this).data('midiExport'));

		// open the modal
		$modal.modal();
	};

	onMidiSave = function () {
		var byteNumbers, blob,
			playerType = $('#midi-export-btn').attr('data-midi-export'),
			$filename = $('#midi-export-name'),
			filename = $.trim($filename.val());

		// use placeholder if a filename wasn't entered
		if (filename === '') {
			filename = $filename.attr('placeholder');
		}
		filename += '.mid';

		// save file
		if (players.hasOwnProperty(playerType)) {
			byteNumbers = $.map(players[playerType]
				.getMidiBytes(selected.tempo,
						$('#midi-export-channel').val(),
						$('#midi-export-instrument').val()).split(''), function (item) {
				return item.charCodeAt(0);
			});
			blob = new Blob([new Uint8Array(byteNumbers)], {
				type: 'audio/midi'
			});
			saveAs(blob, filename);
		}
	};

	onSortModalClick = function () {
		var $modal = $('#modal-sort'),
			selectedSort = global.sort[selected.sort],
			fnArray,
			fnText;
		$modal.find('.sort-name').text(selectedSort.display);
		$modal.find('.nav-tabs a:first').tab('show');
		$modal.find('#sort-info-display').html(selectedSort.display || '&nbsp;');
		$modal.find('#sort-info-stable').html(selectedSort.stable ? 'Yes' : 'No');
		$modal.find('#sort-info-best').html(selectedSort.best || '&nbsp;');
		$modal.find('#sort-info-average').html(selectedSort.average || '&nbsp;');
		$modal.find('#sort-info-worst').html(selectedSort.worst || '&nbsp;');
		$modal.find('#sort-info-memory').html(selectedSort.memory || '&nbsp;');
		$modal.find('#sort-info-method').html(selectedSort.method || '&nbsp;');
		addAceEditor('#sort-algorithm');
		fnArray = $.trim(selectedSort.toString()).split('\n');
		fnText = fnArray.splice(1, fnArray.length - 2).join('\n');
		fnText = js_beautify(fnText, {
			indent_size: 1,
			indent_char: '\t'
		});
		aceEditor.setValue(fnText);
		aceEditor.clearSelection();
		$modal.modal();
	};

	onSortVisualizationButton = function () {
		var $this = $(this),
			type = $this.data('visualization');
		players.sort.setVisualization(type);
	};

	onSaveAlgorithmEdit = function () {
		global.sort[selected.sort] = new Fn(aceEditor.getValue());
		$('#modal-sort').modal('hide');
	};

	onSaveAlgorithmNew = function () {
		var name = $('#new-sort-name').val(),
			nameSafe = name.replace(/[^a-zA-Z]/gi, ''),
			id = nameSafe + '_id_' + (new Date()).getTime();
		if ($.trim(name).length) {
			global.sort[id] = new Fn(aceEditor.getValue());
			global.sort[id].display = name;
			global.sort[id].stable = true;
			global.sort[id].best = '';
			global.sort[id].average = '';
			global.sort[id].worst = '';
			global.sort[id].memory = '';
			global.sort[id].method = '';
		}
		$('#modal-add-algorithm').modal('hide');
		buildSortOptions('#sort-options');
	};

	onAddAlgorithmModalClick = function () {
		var $modal = $('#modal-add-algorithm');
		$modal.find('#new-sort-name').val('');
		addAceEditor('#new-sort-algorithm');
		$modal.modal();
	};

	playerButtonCallback = function (player, action) {
		if (action === 'play' || action === 'reverse' || action === 'stop') {
			player.stop();
		}
	};

	setupPlayers = function () {
		players.base = A.Player.create('#base-section', {
			env: env,
			pluck: pluck,
			isLooping: true,
			hasMarkers: false,
			allowHover: true,
			allowClick: true,
			onClick: function (index, value) {
				baseData[index] = value;
				maxData[index] = getScale(0, baseData.length - 1, 0, maxData.length - 1)(value);
				players.base.setData(getBaseDataAsFrames());
				clearTimeout(clickTimer);
				clickTimer = setTimeout(doSort, clickDelay);
			},
			onPlayerButtonClickCallback: function (e) {
				playerButtonCallback(players.sort, e.action);
			}
		});
		players.sort = A.Player.create('#sort-section', {
			env: env,
			pluck: pluck,
			isLooping: true,
			hasMarkers: true,
			onPlayerButtonClickCallback: function (e) {
				playerButtonCallback(players.base, e.action);
			}
		});
	};

	getSortedScaleNames = function () {
		var names = sc.ScaleInfo.names().sort(function (o1, o2) {
			var ret = 0,
				s1 = sc.ScaleInfo.at(o1),
				s2 = sc.ScaleInfo.at(o2);
			ret = s1.pitchesPerOctave() - s2.pitchesPerOctave();
			if (ret === 0) {
				ret = s1.degrees().length - s2.degrees().length;
				if (ret === 0) {
					ret = s1.name.localeCompare(s2.name);
				}
			}
			return ret;
		});
		return names;
	};

	populateScaleOptions = function (selector) {
		var currentKey, lastKey, scale, scaleNames,
			numPitches, numDegrees,
			$ul = $(selector), $li, htmlString = '';

		scaleNames = getSortedScaleNames();
		$.each(scaleNames, function (index, scaleName) {
			// loop variables
			scale = sc.ScaleInfo.at(scaleName);
			numPitches = scale.pitchesPerOctave();
			numDegrees = scale.degrees().length;
			currentKey = numPitches + '_' + numDegrees;
			if (currentKey !== lastKey) {
				lastKey = currentKey;
				$li = $('<li />').addClass('disabled').wrapInner(
					$('<a href="javascript:void(0);"></a>').text(
						'Octave: ' + numPitches + ' / Notes: ' + numDegrees
					)
				);
				htmlString += $li.wrap('<div />').parent().html();
			}
			$li = $('<li />').attr('data-scale', scaleName).wrapInner(
				$('<a href="javascript:void(0);"></a>').text(scale.name)
			);
			htmlString += $li.wrap('<div />').parent().html();
		});
		$ul.append(htmlString);
		$ul.on('click', 'li', function () {
			var $this = $(this);
			if (!$this.hasClass('disabled')) {
				$ul.find('li').removeClass('active');
				$this.addClass('active');
				selected.scale = $this.data('scale');
				updateDisplayCache('#scale-display', $this.text());
				preloadSoundfonts();
			}
		});
	};

	populateSoundfontOptions = function (selector) {
		var i, instrument, group = '',
			$ul = $(selector), $li, htmlString = '';
		for (i = 0; i < A.instruments.length; i++) {
			instrument = A.instruments[i];
			// output group
			if (group !== instrument.group) {
				group = instrument.group;
				$li = $('<li />').addClass('disabled').wrapInner(
					$('<a href="javascript:void(0);"></a>').text(
						instrument.group
					)
				);
				htmlString += $li.wrap('<div />').parent().html();
			}
			// output instrument
			$li = $('<li />').attr('data-soundfont', instrument.val).wrapInner(
				$('<a href="javascript:void(0);"></a>').text(i + ': ' + instrument.name)
			);
			if (selected.soundfont === i) {
				$li.addClass('active');
			}
			htmlString += $li.wrap('<div />').parent().html();
		}
		$ul.append(htmlString);
		$ul.on('click', 'li', function () {
			var $this = $(this);
			if (!$this.hasClass('disabled')) {
				$ul.find('li').removeClass('active');
				$this.addClass('active');
				selected.soundfont = $this.data('soundfont');
				timbre.soundfont.setInstrument(selected.soundfont);
				updateDisplayCache('#soundfont-display', $this.text());
				updateDisplayCache('#audio-type-display', $this.text());
				preloadSoundfonts();
			}
		});
	};

	preloadSoundfonts = function () {
		var i, midiNotes = [], midi;
		if (selected.audioType === 'soundfont') {
			for (i = 0; i < baseData.length; i++) {
				midi = A.Helper.getMidiNumber(baseData[i]);
				if (midiNotes.indexOf(midi) === -1 && midi >= 0 && midi < 128) {
					midiNotes.push(midi);
				}
			}
			timbre.soundfont.preload(midiNotes);
		}
	};

	onOptionBoxFilter = function () {
		var show = false,
			$this = $(this),
			listId = $this.attr('data-list-id'),
			$listItems = $('#' + listId + ' li'),
			val = $.trim($this.val()),
			regex = new RegExp(val, 'i');
		if (val === '') {
			$listItems.show();
		} else {
			$.each($listItems.get().reverse(), function (index, item) {
				var $item = $(item);
				if ($item.hasClass('disabled')) {
					$item.css('display', show ? 'block' : 'none');
					show = false;
				} else {
					if (regex.test($item.text())) {
						$item.show();
						show = true;
					} else {
						$item.hide();
					}
				}
			});
		}
	};

	workerOnMessage = function (event) {
		var isSortPlaying = players.sort.isPlaying();
		if (event.data.key === workerKey) {
			players.sort.setData(event.data.frames || []);
			players.sort.goToFirst();
			if (isSortPlaying || triggerAutoPlay) {
				clickPlayButton();
			}
		}
		triggerAutoPlay = false;
	};

	workerOnError = function (event) {
		console.log(event);
	};

	doSort = function () {
		workerKey = (new Date()).getTime();

		// browsers that don't support Web Workers will behave slowly
		if (typeof Worker === 'undefined') {
			AS.init(baseData, workerKey);
			global.sort[selected.sort]();
			workerOnMessage({
				data: {
					key: workerKey,
					frames: AS.end(workerKey)
				}
			});
			return;
		}

		// we should terminate our previous worker
		if (worker !== null) {
			worker.removeEventListener('message', workerOnMessage, false);
			worker.removeEventListener('error', workerOnError, false);
			worker.terminate();
		}

		// perform sort in worker thread
		worker = new Worker(workerUrl);
		worker.addEventListener('message', workerOnMessage, false);
		worker.addEventListener('error', workerOnError, false);
		worker.postMessage({
			key : workerKey,
			fn : global.sort[selected.sort].toString(),
			arr : baseData
		});
	};

	Sort.getSelected = function (key, defaultValue) {
		return selected.hasOwnProperty(key) ? selected[key] : defaultValue;
	};

	Sort.getSelectedWaveformInfo = function () {
		return waveform[selected.waveform];
	};

	Sort.getTempoString = function () {
		return 'bpm' + (parseFloat(selected.tempo) || defaults.tempo) + ' l16';
	};

	Sort.init = function (webWorkerUrl) {
		if (typeof webWorkerUrl === 'string') {
			workerUrl = webWorkerUrl;
		}
		// when using a mobile device, decrease samplerate.
		// idea taken from: http://mohayonao.github.io/timbre.js/misc/js/common.js
		if (timbre.envmobile) {
			timbre.setup({samplerate:timbre.samplerate * 0.5});
		}
		// build our sort options
		buildSortOptions('#sort-options');
		// build waveform buttons
		populateWaveformButtons();
		// setup audio and audio players
		setupPlayers();
		// setup base data
		generateData(true, 'randomUnique');
		// populate our scale dropdown
		populateScaleOptions('#scale-options');
		updateDisplayCache(
			'#scale-display',
			$('#scale-options li[data-scale="' + selected.scale + '"]').text()
		);
		$('#scale-filter')
			.on('keyup', onOptionBoxFilter)
			.on('focus', function () {
				$(this).val('');
				$('#scale-options li').show();
			});
		// populate our soundfont dropdown
		populateSoundfontOptions('#soundfont-options');
		updateDisplayCache(
			'#soundfont-display',
			$('#soundfont-options li[data-soundfont="' + selected.soundfont + '"]').text()
		);
		$('#soundfont-filter')
			.on('keyup', onOptionBoxFilter)
			.on('focus', function () {
				$(this).val('');
				$('#soundfont-options li').show();
			});
		// create some of our sliders
		A.Helper.createSlider('#volume-container', defaults.volume, onSliderVolume);
		A.Helper.createSlider('#tempo-container', defaults.tempo, onSliderTempo);
		A.Helper.createSlider('#center-note-container', defaults.centerNote, onSliderCenterNote);
		A.Helper.createSlider('#data-size-container', defaults.dataSize, onSliderDataSize);
		// create our waveform sliders
		waveformSliders.a = A.Helper.createSlider('#waveform-adshr-attack-container', {
			value: waveform[selected.waveform].a, min: 10, max: 500, step: 5
		}, onSliderWaveform);
		waveformSliders.d = A.Helper.createSlider('#waveform-adshr-decay-container', {
			value: waveform[selected.waveform].d, min: 10, max: 2000, step: 5
		}, onSliderWaveform);
		waveformSliders.s = A.Helper.createSlider('#waveform-adshr-sustain-container', {
			value: waveform[selected.waveform].s, min: 0, max: 1, step: 0.01
		}, onSliderWaveform);
		waveformSliders.h = A.Helper.createSlider('#waveform-adshr-hold-container', {
			value: waveform[selected.waveform].h, min: 10, max: 3000, step: 5
		}, onSliderWaveform);
		waveformSliders.r = A.Helper.createSlider('#waveform-adshr-release-container', {
			value: waveform[selected.waveform].r, min: 10, max: 3000, step: 5
		}, onSliderWaveform);
		// cache a few items
		$sortAutoPlay = $('#sort-autoplay');
		// handle button clicks
		$('#audio-type-container .btn').on('click', onAudioTypeButtonClick);
		$('#audio-type-tab-link').on('click', onAudioTypeTabLinkClick);
		$('#audio-type-container .btn[data-audio-type="' + selected.audioType + '"]').click();
		$('#waveform .btn-group .btn').on('click', onWaveformButtonClick);
		$('span[data-midi-export]').on('click', onMidiExportClick);
		$('#midi-export-btn').on('click', onMidiSave);
		$('#modal-sort-open').on('click', onSortModalClick);
		$('#add-algorithm-btn').on('click', onAddAlgorithmModalClick);
		$('#save-algorithm-edit').on('click', onSaveAlgorithmEdit);
		$('#save-algorithm-new').on('click', onSaveAlgorithmNew);
		$('#base-buttons').on('click', '.btn', onAudioDataButton);
		$('#sort-options').on('click', 'li', onSortOptionSelected);
		$('.sort-visualization').on('click', onSortVisualizationButton);
		$('#sort-options [data-sort=' + selected.sort + ']').click();
		// draw envelope canvas
		players.base.drawWaveformCanvases();
		// update slider selction text
		updateDisplayCache('#volume-display', selected.volume);
		updateDisplayCache('#tempo-display', selected.tempo);
		updateDisplayCache('#center-note-display', selected.centerNote, getNoteName);
		updateDisplayCache('#data-size-display', selected.dataSize);
	};

	global.A.Sort = Sort;
}(this));
