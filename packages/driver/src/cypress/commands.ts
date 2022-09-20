import _ from 'lodash'
import { allCommands } from '../cy/commands'
import { addCommand as addNetstubbingCommand } from '../cy/net-stubbing'
import $errUtils from './error_utils'
import $stackUtils from './stack_utils'

import type { QueryFunction } from './utils'

const PLACEHOLDER_COMMANDS = ['mount', 'hover']

const builtInCommands = [
  // `default` is necessary if a file uses `export default` syntax.
  // @ts-ignore
  ..._.toArray(allCommands).map((c) => c.default || c),
  addNetstubbingCommand,
]

const getTypeByPrevSubject = (prevSubject) => {
  if (prevSubject === 'optional') {
    return 'dual'
  }

  if (prevSubject) {
    return 'child'
  }

  return 'parent'
}

const internalError = (path, name) => {
  $errUtils.throwErrByPath(path, {
    args: {
      name,
    },
    stack: (new cy.state('specWindow').Error('add command stack')).stack,
    errProps: {
      appendToStack: {
        title: 'From Cypress Internals',
        content: $stackUtils.stackWithoutMessage((new Error('add command internal stack')).stack || ''),
      } },
  })
}

export default {
  create: (Cypress, cy, state, config) => {
    const reservedCommandNames = new Set(Object.keys(cy))
    const commands = {}

    // we track built in commands to ensure users cannot
    // add custom commands with the same name
    const builtInCommandNames = {}
    let addingBuiltIns

    const Commands = {
      addAllSync (obj) {
        // perf loop
        for (let name in obj) {
          const fn = obj[name]

          Commands.addSync(name, fn)
        }

        // prevent loop comprehension
        return null
      },

      addSync (name, fn) {
        return cy.addCommandSync(name, fn)
      },

      addAll (options = {}, obj) {
        if (!obj) {
          obj = options
          options = {}
        }

        // perf loop
        for (let name in obj) {
          const fn = obj[name]

          Commands.add(name, options, fn)
        }

        // prevent loop comprehension
        return null
      },

      add (name, options, fn) {
        if (builtInCommandNames[name]) {
          internalError('miscellaneous.invalid_new_command', name)
        }

        if (reservedCommandNames.has(name)) {
          internalError('miscellaneous.reserved_command', name)
        }

        // .hover & .mount are special case commands. allow as builtins so users
        // may add them without throwing an error
        if (addingBuiltIns && !PLACEHOLDER_COMMANDS.includes(name)) {
          builtInCommandNames[name] = true
        }

        if (_.isFunction(options)) {
          fn = options
          options = {}
        }

        const { prevSubject } = options

        // normalize type by how they validate their
        // previous subject (unless they're explicitly set)
        const type = options.type ?? getTypeByPrevSubject(prevSubject)

        commands[name] = {
          name,
          fn,
          type,
          prevSubject,
        }

        return cy.addCommand(commands[name])
      },

      overwrite (name, fn) {
        const original = commands[name]

        if (!original) {
          internalError('miscellaneous.invalid_overwrite', name)
        }

        function originalFn (...args) {
          const current = state('current')
          let storedArgs = args

          if (current.get('type') === 'child') {
            storedArgs = args.slice(1)
          }

          current.set('args', storedArgs)

          return original.fn.apply(this, args)
        }

        const overridden = _.clone(original)

        overridden.fn = function (...args) {
          args = ([] as any).concat(originalFn, args)

          return fn.apply(this, args)
        }

        return cy.addCommand(overridden)
      },

      _addQuery (name: string, fn: () => QueryFunction) {
        if (name !== 'get' && cy[name]) {
          internalError('miscellaneous.invalid_new_query', name)
        }

        cy._addQuery({ name, fn })
      },

      overwriteQuery (name, fn) {
        cy._addQuery({ name, fn })
      },
    }

    addingBuiltIns = true
    for (let cmd of builtInCommands) {
      cmd(Commands, Cypress, cy, state, config)
    }
    addingBuiltIns = false

    return Commands
  },
}
