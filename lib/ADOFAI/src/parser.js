class Parser {
    static parseError(f) {
        let e = f.replace(/^\uFEFF/, '');
        e = e.replaceAll('\n\\n', '\\n').replace(/,(\s*[}\]])/g, '$1').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/(\{[^{}]*?)(,)(?=\s*?(\{|\[))/g, '\$1').replace(" \"decorations\"", ",\"decorations\"").replace(",,", ",")
        return e;
    }

    /**
        * @param {string} t - Input Content
        * @param {object} provider - Third-party JSON Parser
        * @returns {object} ADOFAI File Object
    */
    static parseAsObject(t, provider) {
        return ((typeof provider == 'undefined' || typeof provider == 'null') ? JSON : provider).parse(Parser.parseAsText(t));
    }

    /**
        * @param {string} t - Input Content
        * @returns {string} ADOFAI File Content
    */
    static parseAsText(t) {
        return this.parseError(t);
    }
}

export default Parser