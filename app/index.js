"use strict"

const path = require( "path" )

const electron = require( "electron" )
const remote = require( "@electron/remote" )

const common = require( "./lib/common" )
const contentBlocking = require( "./lib/contentBlocking/contentBlockingRenderer" )
const documentRendering = require( "./lib/renderer/documentRendering" )
const file = require( "./lib/file" )
const ipc = require( "./lib/ipc" )
const navigation = require( "./lib/navigation/navigationRenderer" )
const rawTextRenderer = require( "./lib/rawText/rawTextRenderer" )
const hjsStyler = require( "./lib/styler/highlightjs" )

const TITLE = "Markdown Viewer"

function alterTags( tagName, handler ) {
  ;[...document.getElementsByTagName( tagName )].forEach( handler )
}

function updateStatusBar( text ) {
  document.getElementById( "status-text" ).innerHTML = text
}

function clearStatusBar() {
  updateStatusBar( "" )
}

function statusOnMouseOver( element, text ) {
  element.onmouseover = () => updateStatusBar( text )
  element.onmouseout = () => clearStatusBar()
}

function alterStyleURLs( documentDirectory, fileContent ) {
  const pattern = /url\(["'](?<url>.*?)["']\)/
  let isInStyle = false
  let isInCode = false
  const lines = fileContent.split( /\r?\n/ )
  const lineCount = lines.length
  for ( let i = 0; i < lineCount; i++ ) {
    const line = lines[i].trim()
    if ( line === "<style>" ) {
      isInStyle = true
    } else if ( line === "</style>" ) {
      isInStyle = false
    } else if ( line.startsWith( "```" ) ) {
      isInCode = !isInCode
    }
    if ( isInStyle && !isInCode ) {
      const url = line.match( pattern )?.groups.url
      if ( !url || common.isWebURL( url ) ) {
        continue
      }
      lines[i] = line.replace(
        pattern,
        `url("${path.join( documentDirectory, url ).replace( /\\/g, "/" )}")`
      )
    }
  }
  return lines.join( "\n" )
}

function fittingTarget( target, nodeName ) {
  if ( !target ) {
    return null
  }
  if ( target.nodeName === nodeName ) {
    return target
  }
  return fittingTarget( target.parentNode, nodeName )
}

function scrollTo( position ) {
  document.documentElement.scrollTop = position
}

document.addEventListener( "DOMContentLoaded", () => {
  document.title = TITLE
  contentBlocking.init( document, window )
  rawTextRenderer.init( document, window, updateStatusBar )
  navigation.init( document )
  hjsStyler.init( document )
  electron.ipcRenderer.send( ipc.messages.finishLoad )
} )

let _contextMenuAttached = false

electron.ipcRenderer.on(
  ipc.messages.fileOpen,
  ( _, filePath, internalTarget, encoding, scrollPosition ) => {
    contentBlocking.changeInfoElementVisiblity( false )
    clearStatusBar()

    let content = file.openEncodedFile( filePath, encoding )
    let generateRawText = false
    if ( !file.isMarkdown( filePath ) ) {
      const pathParts = filePath.split( "." )
      const language = pathParts.length > 1 ? pathParts[pathParts.length - 1] : ""
      content = "```" + language + "\n" + content + "\n```"
      electron.ipcRenderer.send( ipc.messages.disableRawView )
    } else {
      generateRawText = true
      electron.ipcRenderer.send( ipc.messages.enableRawView )
    }

    // URLs in cotaining style definitions have to be altered before rendering
    const documentDirectory = path.resolve( path.dirname( filePath ) )
    content = alterStyleURLs( documentDirectory, content )

    document.getElementById( "content" ).innerHTML = documentRendering.renderContent( content )
    document.getElementById( "raw-text" ).innerHTML = generateRawText
      ? documentRendering.renderRawText( content )
      : ""

    // Alter local references to be relativ to the document
    alterTags( "a", link => {
      const target = link.getAttribute( "href" )
      if ( target ) {
        navigation.openLink( link, target, documentDirectory )
        statusOnMouseOver( link, target )
      }
    } )
    alterTags( "img", image => {
      const imageUrl = image.getAttribute( "src" )
      if ( !common.isWebURL( imageUrl ) ) {
        image.src = path.join( documentDirectory, imageUrl )
      }
      statusOnMouseOver( image, `${image.getAttribute( "alt" )} (${imageUrl})` )

      image.onerror = () => ( image.style.backgroundColor = "#ffe6cc" )
    } )

    let titlePrefix = filePath
    if ( scrollPosition ) {
      scrollTo( scrollPosition )
    } else if ( internalTarget ) {
      const targetElement = document.getElementById(
        internalTarget.replace( "#", "" ).split( "." )[0]
      )
      if ( targetElement ) {
        scrollTo(
          targetElement.getBoundingClientRect().top -
          document.body.getBoundingClientRect().top
        )
        titlePrefix += internalTarget
      } else {
        titlePrefix += ` ("${internalTarget}" not found)`
      }
    } else {
      scrollTo( 0 )
    }
    document.title = `${titlePrefix} - ${TITLE} ${remote.app.getVersion()}`

    // FIXED: only register the context menu once !
    if ( _contextMenuAttached == false ) {
      _contextMenuAttached = true
      window.addEventListener( "contextmenu", event => {
        const MenuItem = remote.MenuItem
        const menu = new remote.Menu()

        if ( window.getSelection().toString() ) {
          menu.append(
            new MenuItem( {
              label: "Copy selection",
              role: "copy",
            } )
          )
        }

        const target = fittingTarget( event.target, "A" )
        if ( target ) {
          menu.append(
            new MenuItem( {
              label: "Copy link text",
              click() {
                electron.clipboard.writeText( target.innerText )
              },
            } )
          )
          menu.append(
            new MenuItem( {
              label: "Copy link target",
              click() {
                electron.clipboard.writeText( target.getAttribute( "href" ) )
              },
            } )
          )
        }

        // if there's any raw text i.e. if the loaded file is a markdown file
        let rawTextElement = document.getElementById( "raw-text" )
        if ( rawTextElement.innerHTML != "" ) {
          // add a separator if other menu items are present in the context menu
          if ( menu.items.length > 0 ) {
            menu.append( new MenuItem( { type: "separator" } ) )
          }
          // add menu item to toggle the raw text view
          menu.append(
            new MenuItem( {
              label: "Toggle Raw Text View (CTRL+U)",
              click( item, focusedWindow ) {
                let hiddenRawText =
                  document.getElementById( "raw-text" ).style.display == "none"
                if ( hiddenRawText ) {
                  focusedWindow.webContents.send( ipc.messages.viewRawText )
                } else {
                  focusedWindow.webContents.send( ipc.messages.leaveRawText )
                }
              },
            } )
          )
        }

        if ( menu.items.length > 0 ) {
          menu.popup( {
            window: remote.getCurrentWindow(),
          } )
        }
      } )
    }
  }
)

electron.ipcRenderer.on( ipc.messages.prepareReload, ( _, isFileModification ) =>
  electron.ipcRenderer.send(
    ipc.messages.reloadPrepared,
    isFileModification,
    document.documentElement.scrollTop
  )
)

electron.ipcRenderer.on( ipc.messages.restorePosition, ( _, position ) => scrollTo( position ) )


function handleFoundInPage( event, result ) {
  console.log( 'FIND BOX: FOUND' );
  console.log( result.requestId );
  console.log( result.activeMatchOrdinal );
  console.log( result.matches );
  document.getElementById( "search-result" ).innerText = `${result.activeMatchOrdinal}/${result.matches}`;
}

function searchNext(){
  let options = {
    forward: true,
    findNext: false,
    matchCase: false
  }
  let searchText = document.getElementById( "search-text" ).value;
  const requestId = remote.BrowserWindow.getFocusedWindow().webContents.findInPage( searchText, options );
  console.log( 'FIND BOX: SEARCH-NEXT ', requestId );
}

function doSearch() {
  let options = {
    forward: true,
    findNext: true,
    matchCase: false
  }
  let searchText = document.getElementById( "search-text" ).value;
  const requestId = remote.BrowserWindow.getFocusedWindow().webContents.findInPage( searchText, options );
  console.log( 'FIND BOX: SEARCHING ', requestId );
}


function closeFindBox() {
  console.log( 'FIND BOX: CLOSING' );
  remote.BrowserWindow.getFocusedWindow().webContents.stopFindInPage( 'clearSelection' );
  document.getElementById( "find-box" ).style.setProperty( "visibility", "hidden" );
  document.getElementById( "search-close" ).removeEventListener( 'click', closeFindBox );
  document.getElementById( "do-search" ).removeEventListener( 'click', doSearch );
  document.getElementById( "search-next" ).removeEventListener( 'click', searchNext );
}

function showFindBox() {
  console.log( 'FIND BOX: SHOWING' );
  document.getElementById( "find-box" ).style.setProperty( "visibility", "visible" );
  document.getElementById( "search-close" ).addEventListener( 'click', closeFindBox );
  document.getElementById( "do-search" ).addEventListener( 'click', doSearch );
  document.getElementById( "search-next" ).addEventListener( 'click', searchNext );
  remote.BrowserWindow.getFocusedWindow().webContents.on( 'found-in-page', handleFoundInPage );
  document.getElementById( "search-text" ).focus();
}

electron.ipcRenderer.on( ipc.messages.showFindBox, () => {
  showFindBox();
} );

electron.ipcRenderer.on( ipc.messages.findNext, () => {
  if (document.getElementById( "find-box" ).style.getPropertyValue( "visibility") == 'visible') {
    searchNext();
  }
} );
