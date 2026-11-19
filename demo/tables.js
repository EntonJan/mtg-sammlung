// Demo: kein Online-Spieltisch
export const tablesBeta = () => false
export const watchMyTables = (_u, cb) => { setTimeout(() => cb({ mine: [], inv: [] }), 0); return () => {} }
export const watchTable = () => () => {}
const nope = async () => { throw new Error('In der Demo nicht verfügbar') }
export const createTable = nope, joinTable = nope, writeSeat = nope, updateTable = nope, updateSeat = nope, setPrivate = nope, addEvent = nope, getTable = nope
