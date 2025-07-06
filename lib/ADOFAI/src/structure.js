import pathData from './pathdata'
import Parser from './parser'
import customFormatJSON from './format'
import effectProcessor from './effectProcessor'
import * as presets from './presets'

class Level {
    constructor(opt, provider) {
        this._events = new Map();
        this.guidCallbacks = new Map();
        this.guidCounter = 0;

        this._options = opt;
        this._provider = provider;
    }

    generateGUID() {
        return `event_${Date.now()}_${this.guidCounter++}_${Math.floor(Math.random() * 1000)}`;
    }

    load() {
        return new Promise((resolve, reject) => {
            let opt = this._options;
            let options;

            switch (typeof opt) {
                case 'string':
                    try {
                        options = Parser.parseAsObject(opt, this._provider)
                    } catch(e) {
                        reject(e);
                    }
                    break;
                case 'object':
                    options = Object.assign({}, opt);
                    break;
                default:
                    reject("Options must be String or Object", opt)
            }
            if ('pathData' in options) {
                this.angleData = pathData.parseToangleData(options['pathData']);
            } else {
                if ('angleData' in options) {
                    this.angleData = options['angleData'];
                } else {
                    reject("There is not any angle datas.", options)
                }
            }
            if ('actions' in options) {
                this.actions = options['actions'];
            } else {
                this.actions = [];
            }
            if ('settings' in options) {
                this.settings = options['settings'];
            } else {
                reject("There is no ADOFAI settings.", options)
            }
            if ('decorations' in options) {
                this.__decorations = options['decorations'];
            } else {
                this.__decorations = [];
            }
            this.tiles = [];
            this._angleDir = -180;
            this._twirlCount = 0;
            this._createArray(this.angleData.length, { angleData: this.angleData, actions: this.actions, decorations: this.__decorations })
                .then(e => {
                    this.tiles = e;
                    this.trigger('load', this);
                    resolve(true)
            }).catch(e => {
                reject(e);
            })

        })

    }

    /**
        * @param {string} eventName EventName
        * @param {function} callback Callback
        * @returns {string} only GUID
    */
    on(eventName, callback) {
        if (!this._events.has(eventName)) {
            this._events.set(eventName, []);
        }

        const guid = this.generateGUID();
        const eventCallbacks = this._events.get(eventName);

        eventCallbacks.push({ guid, callback });
        this.guidCallbacks.set(guid, { eventName, callback });

        return guid;
    }

    /**
        * @param {string} eventName EventName
        * @param {any} args args to call
    */
    trigger(eventName, ...args) {
        if (!this._events.has(eventName)) {
            return;
        }

        const eventCallbacks = this._events.get(eventName);
        eventCallbacks.forEach(({ callback }) => {
            callback(...args);
        });
    }

    /**
        * @param {string} guid only GUID to clear events registered.
    */
    off(guid) {
        if (!this.guidCallbacks.has(guid)) {
            return false;
        }

        const { eventName, callback } = this.guidCallbacks.get(guid);

        if (this._events.has(eventName)) {
            const eventCallbacks = this._events.get(eventName);
            this._events.set(
                eventName,
                eventCallbacks.filter(({ guid: cbGuid, callback: cb }) =>
                    cbGuid !== guid && cb !== callback
                )
            );
        }

        this.guidCallbacks.delete(guid);
        return true;
    }

    offEvent(eventName) {
        if (this._events.has(eventName)) {
            const eventCallbacks = this._events.get(eventName);
            eventCallbacks.forEach(({ guid }) => {
                this.guidCallbacks.delete(guid);
            });
            this._events.delete(eventName);
        }
    }

    _filterByFloor(arr, i) {
        let actionT = arr.filter(item => item.floor === i);
        this._twirlCount += actionT.filter(t => t.eventType == 'Twirl').length;
        return actionT.map(({ floor, ...rest }) => rest);
    }

    _filterByFloorwithDeco(arr, i) {
        let actionT = arr.filter(item => item.floor === i);
        return actionT.map(({ floor, ...rest }) => rest);
    }

    async _createArray(xLength, opt) {
        let m = Array.from({ length: xLength }, (_, i) => ({
            direction: opt.angleData[i],
            _lastdir: opt.angleData[i - 1] || 0,
            actions: this._filterByFloor(opt.actions, i),
            angle: this._parseAngle(opt.angleData, i, this._twirlCount % 2),
            addDecorations: this._filterByFloorwithDeco(opt.decorations, i),
            twirl: this._twirlCount
        }));
        return m;
    }

    _changeAngle() {
        let y = 0;
        let m = this.tiles.map(t => {
            y++;
            t.angle = this._parsechangedAngle(t.direction, y, t.twirl, t._lastdir);
            return t;
        })
        return m;
    }

    _parsechangedAngle(agd, i, isTwirl, lstagd) {
        let prev = 0;
        if (i == 0) { this._angleDir = 180 }
        if (agd == 999) {
            this._angleDir = lstagd;
            if (this._angleDir == NaN) {
                this._angleDir = 0;
            }
            prev = 0;
        } else {
            if (isTwirl === 0) {
                prev = (this._angleDir - agd) % 360;
            } else {
                prev = 360 - (this._angleDir - agd) % 360;
            }
            if (prev === 0) {
                prev = 360;
            }
            this._angleDir = agd + 180;
        }
        return prev;

    }

    _parseAngle(agd, i, isTwirl) {
        let prev = 0;
        if (i == 0) { this._angleDir = 180 }
        if (agd[i] == 999) {
            this._angleDir = agd[i - 1];
            if (this._angleDir == NaN) {
                this._angleDir = 0;
            }
            prev = 0;
        } else {
            if (isTwirl === 0) {
                prev = (this._angleDir - agd[i]) % 360;
            } else {
                prev = 360 - (this._angleDir - agd[i]) % 360;
            }
            if (prev === 0) {
                prev = 360;
            }
            this._angleDir = agd[i] + 180;
        }
        return prev;

    }

    _flattenActionsWithFloor(arr) {
        return arr.flatMap((item, index) =>
            (item.actions || []).map(action => ({
                floor: index,
                ...action,
            }))
        );
    }

    _flattenAngleDatas(arr) {
        return arr.flatMap((item) => {
            return item.direction;
        });
    }

    _flattenDecorationsWithFloor(arr) {
        return arr.flatMap((item, index) =>
            (item.addDecorations || []).map(addDecorations => ({
                floor: index,
                ...addDecorations,
            }))
        );
    }


    filterActionsByEventType(en) {
        return Object.entries(this.tiles)
            .flatMap(([index, a]) =>
                (a.actions || []).map(b => ({ b, index }))
            )
            .filter(({ b }) => b.eventType === en)
            .map(({ b, index }) => ({
                index: Number(index),
                action: b
            }));
    }

    /**
        * Calculate Tile Positions [x,y]
    */
    calculateTileCoordinates() {
        let angles = this.angleData;
        let floats = [];
        let midSpins = [];
        let startPos = [0, 0];

        for (let i = 0; i < this.tiles.length; i++) {
            let value = angles[i];
            //midSpins.push(value == 999f);
            if (value == 999) {
                value = angles[i - 1] + 180;
            }
            floats.push(value);
        }

        for (let i = 0; i <= floats.length; i++) {
            let angle1 = Number((i == floats.length) ? floats[i - 1] : floats[i]) || 0;
            let angle2 = Number((i == 0) ? 0 : floats[i - 1]) || 0;
            let midspinIndex = i == floats.length ? i - 1 : i;
            let currentTile = this.tiles[i];
            if (this.getActionsByIndex('PositionTrack',i).count > 0) {
                let pevent = this.getActionsByIndex('PositionTrack',i).actions[0];
                if (pevent.hasOwnProperty("positionOffset")) {
                    if (pevent['editorOnly'] !== true & pevent['editorOnly'] !== 'Enabled') {
                        startPos[0] += pevent['positionOffset'][0];
                        startPos[1] += pevent['positionOffset'][1];
                    }
                }
            }
            startPos[0] += Math.cos(angle1 * Math.PI / 180);
            startPos[1] += Math.sin(angle1 * Math.PI / 180);
            if (typeof currentTile !== 'undefined') {
                currentTile.position = [
                    Number(startPos[0].toFixed(8)),
                    Number(startPos[1].toFixed(8))
                ];
                currentTile.position.angle1 = angle1;
                currentTile.position.angle2 = angle2 - 180;
                currentTile.position.cangle = i == floats.length ? floats[i - 1] + 180 : floats[i];
            }

        }

        return;
    }


    /**
        * Get Actions according to tile's id and eventType
    */
    getActionsByIndex(en, index) {
        const filtered = this.filterActionsByEventType(en);
        const matches = filtered.filter(item => item.index === index);

        return {
            count: matches.length,
            actions: matches.map(item => item.action)
        };
    }

    /**
        * Operate floors
    */
    floorOperation(info = { type: 'append', direction: 0 }) {
        switch (info.type) {
            case 'append':
                this.appendFloor(info);
                break;
            case 'insert':
                this.tiles.splice(info.id, 0, {
                    direction: info.direction,
                    angle: 0,
                    actions: [],
                    addDecorations: [],
                    _lastdir: this.tiles[info.id - 1].direction,
                    twirl: this.tiles[info.id - 1].twirl
                })
                break;
            case 'delete':
                this.tiles.splice(info.id, 1);
                break;
            default:
                return;
        }
        this._changeAngle();
    }

    /**
        * Append a floor to ADOFAI.Level
    */
    appendFloor(args) {
        this.tiles.push({
            direction: args.direction,
            angle: 0,
            actions: [],
            addDecorations: [],
            _lastdir: this.tiles[this.tiles.length - 1].direction,
            twirl: this.tiles[this.tiles.length - 1].twirl
        })
        this._changeAngle();
    }

    /**
        * Clean Decorations from ADOFAI.Level
    */
    clearDeco() {
        this.tiles = effectProcessor.clearDecorations(this.tiles);
        return true;
    }

    /**
        * Clear Events by preset's name
        * @param {string} presetName PresetName
    */
    clearEffect(presetName) {
        this.clearEvent(presets[presetName]);
    }

    /**
        * Clear Events by preset object
        * @param {object} preset
    */
    clearEvent(preset) {
        switch (preset.type) {
            case 'include':
                this.tiles = effectProcessor.keepEvents(preset.events, this.tiles)
                break;
            case 'exclude':
                this.tiles = effectProcessor.clearEvents(preset.events, this.tiles)
                break;
            default:
                break;
        }
    }

    /**
        * Export ADOFAI.Level as ADOFAI File or Object
        * @param {string} type Export Type: 'string' or 'object'
        * @param {number} b indent
        * @param {boolean} c whether use ADOFAI Indent Style
    */
    export(type, b, c = true) {
        let ADOFAI = {
            angleData: this._flattenAngleDatas(this.tiles),
            settings: this.settings,
            actions: this._flattenActionsWithFloor(this.tiles),
            decorations: this._flattenDecorationsWithFloor(this.tiles)
        }
        return type == 'object' ? ADOFAI : customFormatJSON(ADOFAI, b, c);
    }
}

export default Level;