"use strict"

const fs = require( "fs" )
const path = require( "path" )
const childProcess = require( "child_process" )
const electron = require( "electron" )
const common = require( "./lib/common" )
const contentBlocking = require( "./lib/contentBlocking/contentBlockingMain" )
const encodingLib = require( "./lib/main/encoding" )
const ipc = require( "./lib/ipc" )
const navigation = require( "./lib/navigation/navigationMain" )
const rawText = require( "./lib/rawText/rawTextMain" )
const ApplicationSettings = require( './lib/settings/application-settings' )
const DocumentSettings = require( './lib/settings/document-settings' )
const { printToPDF } = require( './lib/pdf' )
const { generateStylesSubmenu } = require( './lib/styler/highlightjs' )
const { showAboutWindow } = require( './lib/messageBoxes/about' )
const { generateLastFilesMenuTemplate } = require('./lib/file')
const { MenuItem } = require('electron');
const { Menu } = require( 'electron' )



const WINDOW_WIDTH = 1024
const WINDOW_HEIGHT = 768
const WINDOW_MIN_WIDTH = 640
const WINDOW_MIN_HEIGHT = 480

const DEFAULT_FILE = path.join( __dirname, "..", "README.md" )
const UPDATE_INTERVAL = 1000 // ms
const UPDATE_FILE_TIME_NAV_ID = "update-file-time"

let _isTest = false
let _mainWindow
let _mainMenu
let _lastModificationTime
let _isReloading = false
let _scrollPosition = 0
let _applicationSettings
let _documentSettings

function error( msg ) {
  console.error( "Error:", msg )
  electron.dialog.showErrorBox( "Error", `${msg}. Exiting.` )
  process.exit( 1 )
}

function openFile( filePath, internalTarget ) {
  let _applicationSettings = new ApplicationSettings();
  if ( !fs.existsSync( filePath ) ) {
    _applicationSettings.removeLastOpenedFile(filePath);
    error( `Unknown file: "${filePath}"` )
  } else if ( !fs.lstatSync( filePath ).isFile() ) {
    _applicationSettings.removeLastOpenedFile(filePath);
    error( "Given path does not lead to a file" )
  } else {
    navigation.go( filePath, internalTarget )
    _lastModificationTime = fs.statSync( filePath ).mtimeMs
    if (DEFAULT_FILE != filePath) {
      // add current file to the "last 10 files"
      _applicationSettings.addLastOpenedFile(filePath);
      // update the menu´s "last 10 files"
      generateMainMenu(_mainWindow);
    }
  }
}

function extractFilePath( args ) {
  return args.find(
    arg =>
      arg !== process.execPath &&
      arg !== "." &&
      arg !== electron.app.getAppPath() &&
      arg !== "data:," &&
      !arg.startsWith( "-" ) &&
      !arg.includes( "spectron-menu-addon-v2" )
  )
}

function extractInternalTarget( args ) {
  return args.find( arg => arg.startsWith( "#" ) )
}

function createChildWindow( filePath, internalTarget ) {
  const processName = process.argv[0]
  const args = processName.includes( "electron" ) ? [".", filePath] : [filePath]
  if ( internalTarget !== undefined ) {
    args.push( internalTarget )
  }
  childProcess.spawn( processName, args )
}

function reload( isFileModification ) {
  _mainWindow.webContents.send(
    ipc.messages.prepareReload,
    isFileModification
  )
}

function restorePosition() {
  _mainWindow.webContents.send( ipc.messages.restorePosition, _scrollPosition )
}

/**
 * generate/update the application main menu
 * @param {*} win the electron window to add the menu to
 * @returns the newly created menu
 */
function generateMainMenu(win){
  // generate the static menu from template
  const newMenu = Menu.buildFromTemplate( [
    {
      label: "&File",
      id: "filemenu",
      submenu: [
        {
          label: "Open",
          id: "openfile",
          accelerator: "CmdOrCtrl+O",
          async click() {
            try {
              const result = await electron.dialog.showOpenDialog( {
                properties: ["openFile"],
                filters: [{name: "Markdown", extensions: common.FILE_EXTENSIONS}]
              } )
              if ( !result.canceled ) {
                const filePath = result.filePaths[0]
                openFile( filePath, null )
                Menu.getApplicationMenu().getMenuItemById( encodingLib.toMenuItemID( _documentSettings.getDocumentEncoding( filePath ) ) ).checked = true
              }
            } catch ( e ) {
              error( `Problem at opening file:\n ${e}` )
            }
          }
        },
        { label:'last 10 files', id: 'last10files', visible: false}, // position mark
        { type: "separator" },
        {
          label: "Print",
          accelerator: "Ctrl+P",
          click() { win.webContents.print() }
        },
        {
          label: "Print to PDF",
          click() { printToPDF() }
        },
        { type: "separator" },
        {
          label: "Quit",
          accelerator: "Alt+F4",
          click() { win.close() }
        }
      ],
    },
    {
      label: "&Edit",
      submenu: [
        { role: "copy" }, 
        { 
          label: "Find", 
          id: "show-find-box", 
          accelerator:"CmdOrCtrl+F",
          click() { win.webContents.send(ipc.messages.showFindBox) }
        },
        { 
          label: "Find next...", 
          id: "find-next", 
          accelerator:"F3",
          click() { win.webContents.send(ipc.messages.findNext) }
        },

      ],
    },
    {
      label: "&View",
      submenu: [
        {
          label: "Back",
          accelerator: "Alt+Left",
          id: navigation.BACK_MENU_ID,
          click() { navigation.back() },
        },
        {
          label: "Forward",
          accelerator: "Alt+Right",
          id: navigation.FORWARD_MENU_ID,
          click() { navigation.forward() },
        },
        { type: "separator" },
        {
          label: "Refresh",
          accelerator: "F5",
          click() { reload( false ) },
        },
        {
          label: "Unblock All External Content",
          accelerator: "Alt+U",
          id: contentBlocking.UNBLOCK_CONTENT_MENU_ID,
          click() { contentBlocking.unblockAll() },
        },
        {
          label: "Toggle Raw Text View",
          accelerator: "Ctrl+U",
          id: rawText.VIEW_RAW_TEXT_MENU_ID,
          click() { rawText.switchRawView() },
        },
        { type: "separator" },
        {
          label: "Switch Theme",
          accelerator: "F8",
          click() {
            _applicationSettings.theme = electron.nativeTheme.shouldUseDarkColors
              ? _applicationSettings.LIGHT_THEME
              : _applicationSettings.DARK_THEME
          },
        },
        {
          label: "Change Code &Style",
          submenu: generateStylesSubmenu(),
        },
      ],
    },
    {
      label: "En&coding",
      submenu: encodingLib.ENCODINGS.map( encoding => ( {
        label: encoding,
        type: "radio",
        id: encodingLib.toMenuItemID( encoding ),
        click() {
          _documentSettings.setDocumentEncoding( navigation.getCurrentLocation().filePath, encoding )
          reload( true )
        },
      } ) ),
    },
    {
      label: "?",
      submenu: [
        {
          label: "Toggle Developer Tools",
          accelerator: "F10",
          click() {
            if (win.webContents.isDevToolsOpened()){
              win.webContents.closeDevTools();
            } else {
              win.webContents.openDevTools({ mode: 'detach' });
            }
          }
        },
        { type: "separator" },
        { 
          label: "Clear the 'last opened files' list",
          click() { 
            let _applicationSettings = new ApplicationSettings();
            _applicationSettings.clearLastOpenedFilesList();
            generateMainMenu(win);
          }
        },
        { type: "separator" },
        {
          label: "About...",
          accelerator: "F1",
          click() { showAboutWindow(win) }
        }
      ],
    },
  ] )

  // add dynamically the "last 10 files" menu items
  let fileMenuSubmenu = newMenu.getMenuItemById('filemenu').submenu;
  let newItemPosition = fileMenuSubmenu.items.findIndex(item => item.id == 'last10files') + 1; 
  generateLastFilesMenuTemplate().forEach(lastfileMenuItem => {     
      lastfileMenuItem.click = (item) => {
        openFile(item.id, null);
        Menu.getApplicationMenu().getMenuItemById( encodingLib.toMenuItemID( _documentSettings.getDocumentEncoding( item.id ) ) ).checked = true
      }
      fileMenuSubmenu.insert(newItemPosition, new MenuItem (lastfileMenuItem));
      newItemPosition++;
    });

  // activate the menu
  Menu.setApplicationMenu(newMenu);
  return newMenu;
}

function createWindow() {
  const mainWindow = new electron.BrowserWindow( {
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    backgroundColor: "#fff",
    // autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      contextIsolation: false,
    },
  } )
  mainWindow.loadFile( path.join( __dirname, "index.html" ) )
  mainWindow.on( "closed", () => ( _mainWindow = null ) )
  mainWindow.webContents.on( "did-finish-load", () => {
    if ( _isReloading ) {
      restorePosition()
      _isReloading = false
    }
  } )

  mainWindow.webContents.on("devtools-opened", () => {mainWindow.focus()});
  return [mainWindow, generateMainMenu(mainWindow)]
}

electron.app.on( "ready", () => {
  require( "@electron/remote/main" ).initialize()

  _isTest = process.argv.includes( "--test" )
  _applicationSettings = new ApplicationSettings()
  _documentSettings = new DocumentSettings()

  const [mainWindow, mainMenu] = createWindow()
  _mainMenu = mainMenu
  _mainWindow = mainWindow

  navigation.init( mainWindow, _mainMenu, null, _documentSettings )
  contentBlocking.init( mainWindow, _mainMenu )
  rawText.init( mainWindow, _mainMenu )
  electron.nativeTheme.themeSource = _applicationSettings.theme
} )

electron.app.on( "window-all-closed", () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if ( process.platform !== "darwin" ) {
    electron.app.quit()
  }
} )

electron.app.on( "activate", () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if ( _mainWindow === null ) {
    createWindow()
  }
} )

electron.ipcMain.on( ipc.messages.finishLoad, () => {
  const args = process.argv
  // console.debug( args )

  const filePath = navigation.hasCurrentLocation()
    ? navigation.getCurrentLocation().filePath
    : extractFilePath( args )
  const internalTarget = extractInternalTarget( args )
  if ( filePath !== undefined ) {
    openFile( filePath, internalTarget )
  } else {
    openFile( DEFAULT_FILE, internalTarget )
  }
  // initialize the ENCODING menu item
  _mainMenu.getMenuItemById( encodingLib.toMenuItemID( _documentSettings.getDocumentEncoding( filePath ?? DEFAULT_FILE ) ) ).checked = true
  // initialize the HIGHLIGHTJS STYLE and the corresponding menu item after (!) the application is loaded
  _mainMenu.getMenuItemById( _applicationSettings.highlightjsStyle ).checked = true
  _mainWindow.webContents.send( ipc.messages.changeHighlightjsStyle, _applicationSettings.highlightjsStyle )
} )

electron.ipcMain.on( ipc.messages.reloadPrepared, ( _, isFileModification, position ) => {
  _scrollPosition = position
  _isReloading = true
  if ( isFileModification ) {
    navigation.reloadCurrent( position )
  } else {
    _mainWindow.reload()
  }
  restorePosition()
} )

electron.ipcMain.on( ipc.messages.openFileInNewWindow, ( _, filePath ) => createChildWindow( filePath ) )

electron.ipcMain.on( ipc.messages.openInternalInNewWindow, ( _, target ) =>
  createChildWindow( navigation.getCurrentLocation().filePath, target )
)

// Based on https://stackoverflow.com/a/50703424/13949398 (custom error window/handling in Electron)
process.on( "uncaughtException", error => {
  console.error( `Unhandled error: ${error.stack}` )
  if ( !_isTest ) {
    electron.dialog.showMessageBoxSync( {
      type: "error",
      title: "Unhandled error (fault of Markdown Viewer)",
      message: error.stack,
    } )
  }
  electron.app.exit( 1 )
} )

setInterval( () => {
  if ( navigation.hasCurrentLocation() ) {
    const filePath = navigation.getCurrentLocation().filePath
    fs.stat( filePath, ( err, stats ) => {
      if ( err ) {
        console.error( `Updating file "${filePath}" was aborted with error ${err}` )
        return
      }
      let mtime = stats.mtimeMs
      if ( _lastModificationTime && mtime !== _lastModificationTime ) {
        console.debug( "Reloading..." )
        _lastModificationTime = mtime
        reload( true )
      }
    } )
  }
}, UPDATE_INTERVAL )

navigation.register( UPDATE_FILE_TIME_NAV_ID, lastModificationTime => {
  const time = _lastModificationTime
  _lastModificationTime = lastModificationTime
  return time
} )
