export const preset_noeffect = {
    type: 'exclude', events: [
        'Flash',
        'SetFilter',
        'SetFilterAdvanced',
        'HallOfMirrors',
        'Bloom',
        'ScalePlanets',
        'ScreenTile',
        'ScreenScroll',
        'ShakeScreen'
    ]
};

export const preset_noholds = {
    type: 'exclude', events: [
        'Hold',
    ]
}

export const preset_nomovecamera = {
    type: 'exclude', events: [
        'MoveCamera',
    ]
}

export const preset_noeffect_completely = {
    type: 'exclude', events: [
        "AddDecoration",
        "AddText",
        "AddObject",
        "Checkpoint",
        "SetHitsound",
        "PlaySound",
        "SetPlanetRotation",
        "ScalePlanets",
        "ColorTrack",
        "AnimateTrack",
        "RecolorTrack",
        "MoveTrack",
        "PositionTrack",
        "MoveDecorations",
        "SetText",
        "SetObject",
        "SetDefaultText",
        "CustomBackground",
        "Flash",
        "MoveCamera",
        "SetFilter",
        "HallOfMirrors",
        "ShakeScreen",
        "Bloom",
        "ScreenTile",
        "ScreenScroll",
        "SetFrameRate",
        "RepeatEvents",
        "SetConditionalEvents",
        "EditorComment",
        "Bookmark",
        "Hold",
        "SetHoldSound",
        //"MultiPlanet",
        //"FreeRoam",
        //"FreeRoamTwirl",
        //"FreeRoamRemove",
        "Hide",
        "ScaleMargin",
        "ScaleRadius"
    ]
}

export const preset_inner_no_deco = {
    type: "special", events: [
        "MoveDecorations",
        "SetText",
        "SetObject",
        "SetDefaultText"
    ]
}

