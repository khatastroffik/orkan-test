"use strict"

const Settings = require( './settings' )

const APPLICATION_SETTINGS_FILENAME = "application-settings.json"

class ApplicationSettings extends Settings {
  THEME_KEY = "theme"
  HLJS_KEY = "highlightjs"
  LASTFILES_KEY = 'lastfiles'
  LIGHT_THEME = "light"
  DARK_THEME = "dark"
  ALLOWED_THEMES = [this.LIGHT_THEME, this.DARK_THEME]
  _electronNativeTheme

  constructor ( settingsFileName = null, electronInstance = null ) {
    if ( ApplicationSettings._singleton ) {
      return ApplicationSettings._singleton
    }
    super( settingsFileName ?? APPLICATION_SETTINGS_FILENAME, electronInstance )
    ApplicationSettings._singleton = this
    this._electronNativeTheme = this._electronInstance.nativeTheme
  }

  get highlightjsStyle() {
    // if no already saved setting is available (e.g. initial app start before any style has been saved)
    // then we return an empty string -> the default style from the "index.html" will then be used
    return this._settingsData[this.HLJS_KEY] ?? ""
  }

  set highlightjsStyle( hjsStyle ) {
    this._settingsData[this.HLJS_KEY] = hjsStyle
    this.save()
  }

  get theme() {
    return this._settingsData[this.THEME_KEY] ?? this._electronNativeTheme.themeSource
  }

  set theme( value ) {
    if ( !this.ALLOWED_THEMES.includes( value ) ) {
      throw {
        message: `"${value}" is not one of the allowed values [${this.ALLOWED_THEMES.join( ", " )}]`,
      }
    }
    this._settingsData[this.THEME_KEY] = this._electronNativeTheme.themeSource = value
    this.save()
  }

  clearLastOpenedFilesList(){
    this._settingsData[this.LASTFILES_KEY] = [];
    this.save();
  }

  removeLastOpenedFile( filePath ) {
    let allFiles = this.lastOpenedFiles;
    let itemPos = allFiles.indexOf( filePath );
    if (itemPos >= 0) {
      allFiles.splice( itemPos, 1 );
      this._settingsData[this.LASTFILES_KEY] = allFiles;
      this.save();
    }
  }

  addLastOpenedFile( filePath ) {
    // remove file from its current position, if in the list   
    this.removeLastOpenedFile(filePath);
    // add file to the top of the list
    let allFiles = this.lastOpenedFiles;
    allFiles.unshift( filePath );
    // limit size of the list to 10 files
    if ( allFiles.length > 10 ) {
      allFiles.length = 10;
    }
    this._settingsData[this.LASTFILES_KEY] = allFiles;
    this.save();
  }

  get lastOpenedFiles() {
    return this._settingsData[this.LASTFILES_KEY] ?? [];
  }

}

module.exports = ApplicationSettings
