const NAF = require('networked-aframe')

import Application from './classes/Application'

class JanusAdapter {
  application: Application

  constructor() {
    this.application = new Application()
  }
}

NAF.adapters.register('janus', JanusAdapter)

export default JanusAdapter
