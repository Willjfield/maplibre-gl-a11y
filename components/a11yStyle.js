export function createAccessibleStyleMode({ map, accessibleStyle, initialStyle, announce }) {
    let hasSwitchedToAccessibleStyle = false;

    function activate() {
        if (!accessibleStyle) {
            announce('Accessible map style is not configured for this control.', true);
            return false;
        }
        map.setStyle(accessibleStyle);
        hasSwitchedToAccessibleStyle = true;
        announce('Accessible map style mode active.', true);
        return true;
    }

    function deactivate() {
        if (!hasSwitchedToAccessibleStyle) {
            return;
        }
        map.setStyle(initialStyle);
        hasSwitchedToAccessibleStyle = false;
    }

    return {
        activate,
        deactivate
    };
}
