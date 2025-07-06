
/**
    * @param {object} obj - JSON Object
    * @param {number} indent - No usage
    * @param {boolean} isRoot - Is JSON the Root?
    * @returns ADOFAI File Content or Object
*/
function customFormatJSON(obj, indent = 0, isRoot = false) {

  if (typeof obj !== 'object' || obj === null) {
    return JSON.stringify(obj);
  }
  
  if (Array.isArray(obj)) {
    const allPrimitives = obj.every(item => 
      typeof item !== 'object' || item === null
    );
    
    if (allPrimitives) {
      return '[' + obj.map(item => customFormatJSON(item)).join(',') + ']';
    }
    
    const spaces = ' '.repeat(indent);
    const arrayItems = obj.map(item => 
      spaces + '  ' + formatAsSingleLine(item)
    ).join(',\n');
    
    return '[\n' + arrayItems + '\n' + spaces + ']';
  }
  
  const spaces = ' '.repeat(indent);
  const keys = Object.keys(obj);
  
  if (isRoot) {
    const objectItems = keys.map(key => 
      '  ' + JSON.stringify(key) + ': ' + customFormatJSON(obj[key], 2)
    ).join(',\n');
    
    return '{\n' + objectItems + '\n}';
  }
  
  const objectItems = keys.map(key => 
    spaces + '  ' + JSON.stringify(key) + ': ' + customFormatJSON(obj[key], indent + 2)
  ).join(',\n');
  
  return '{\n' + objectItems + '\n' + spaces + '}';
}

/**
    * @param {Array} obj Eventlist to keep
    * @returns {string} JSON formated as singleline
*/
function formatAsSingleLine(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return customFormatJSON(obj);
  }
  
  if (Array.isArray(obj)) {
    return '[' + obj.map(formatAsSingleLine).join(',') + ']';
  }
  
  const keys = Object.keys(obj);
  const entries = keys.map(key => 
    JSON.stringify(key) + ': ' + formatAsSingleLine(obj[key])
  ).join(', ');
  
  return '{' + entries + '}';
}

export default customFormatJSON;