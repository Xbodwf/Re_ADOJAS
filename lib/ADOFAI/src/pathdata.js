const pathDataTable = { "R": 0, "p": 15, "J": 30, "E": 45, "T": 60, "o": 75, "U": 90, "q": 105, "G": 120, "Q": 135, "H": 150, "W": 165, "L": 180, "x": 195, "N": 210, "Z": 225, "F": 240, "V": 255, "D": 270, "Y": 285, "B": 300, "C": 315, "M": 330, "A": 345, "5": 555, "6": 666, "7": 777, "8": 888, "!": 999 };

/**
    * @param {string} pathdata - PathData from ADOFAI
    * @returns {Array} Converted AngleData
*/
function parseToangleData(pathdata) {
    let pt = Array.from(String(pathdata));
    pt = pt.map(t => pathDataTable[t]);
    return pt;
}

export default {
    pathDataTable,
    parseToangleData
}