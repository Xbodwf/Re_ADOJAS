import * as presets from './presets'

/**
    * @param {Array} tiles ADOFAI Tiles from ADOFAI.Level
    * @returns {Array} new Tiles
*/
function clearDecorations(tiles) {
  if (!Array.isArray(tiles)) {
    throw new Error('Arguments are not supported.');
  }
  
  return tiles.map(tile => {
    const newTile = { ...tile };

    if (newTile.hasOwnProperty('addDecorations')) {
      newTile.addDecorations = [];
    }
    
    if (Array.isArray(newTile.actions)) {
      newTile.actions = newTile.actions.filter(action => 
        !presets.preset_inner_no_deco.events.includes(action.eventType)
      );
    }
    
    return newTile;
  });
}

/**
    * @param {Array} eventTypes Eventlist to remove
    * @param {Array} tiles ADOFAI Tiles from ADOFAI.Level
    * @returns {Array} new Tiles
*/
function clearEvents(eventTypes,tiles) {
  return tiles.map(tile => {
    const newTile = { ...tile }; 
    if (Array.isArray(newTile.actions)) {
      newTile.actions = newTile.actions.filter(action => 
         !eventTypes.includes(action.eventType)
      );
    }
    
    return newTile;
  });
}

/**
    * @param {Array} eventTypes Eventlist to keep
    * @param {Array} tiles ADOFAI Tiles from ADOFAI.Level
    * @returns {Array} new Tiles
*/
function keepEvents(eventTypes,tiles) {
  return tiles.map(tile => {
    const newTile = { ...tile }; 
    if (Array.isArray(newTile.actions)) {
      newTile.actions = newTile.actions.filter(action => 
        eventTypes.includes(action.eventType)
      );
    }
    
    return newTile;
  });
}


const effectProcessor = {
  clearDecorations,
  clearEvents,
  keepEvents
}
export default effectProcessor;