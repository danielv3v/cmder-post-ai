-- Integration with the Cmder window in frontend/ (loaded by Clink from this folder).
-- Does nothing unless the shell runs inside that window (CMDER_UI is set).

-- !!! THIS FILE IS OVERWRITTEN WHEN CMDER IS UPDATED
-- !!! Use "%CMDER_ROOT%\config\<whatever>.lua" to add your lua startup scripts

-- luacheck: globals clink

if not os.getenv("CMDER_UI") then
    return
end

local ESC = "\x1b"

-- The window listens for OSC 7337 requests from the shell.
local function request(payload)
    io.write(ESC .. "]7337;" .. payload .. ESC .. "\\")
    io.flush()
end

-- Slash commands typed at the prompt. They never reach cmd.exe.
--   /settings        open the settings panel
--   /theme <name>    switch theme, e.g. /theme nord
--   /new             open the shell picker (same as Ctrl+T)
clink.onfilterinput(function(text)
    local cmd, arg = text:match("^%s*(/%a+)%s*(.-)%s*$")
    if not cmd then
        return
    end
    cmd = cmd:lower()
    if cmd == "/settings" then
        request("settings")
    elseif cmd == "/theme" and arg ~= "" then
        request("theme=" .. arg)
    elseif cmd == "/new" then
        request("palette")
    else
        return
    end
    return "", false
end)
