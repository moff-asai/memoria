import assert from "node:assert/strict"
import test from "node:test"
import { relativePlace, isFreshLocation } from "../src/placeGeometry.ts"
import { validLocation, validPhotos, validTitle } from "../supabase/functions/place-memories/validation.ts"
const owner="00000000-0000-4000-8000-000000000001"
const id="00000000-0000-4000-8000-000000000002"
const photo="00000000-0000-4000-8000-000000000003"
const position={ latitude:0, longitude:0, accuracy_m:5, captured_at:new Date().toISOString() }
test("geographic positions preserve north/east bearings and small real distances", () => {
  const north=relativePlace(position,{latitude:0.0001,longitude:0})
  const east=relativePlace(position,{latitude:0,longitude:0.0001})
  assert(north.distance>11 && north.distance<12); assert(Math.abs(north.bearing)<1e-10)
  assert(Math.abs(east.bearing-Math.PI/2)<1e-10)
  assert(relativePlace({latitude:0,longitude:179.9999},{latitude:0,longitude:-179.9999}).distance<23)
})
test("stale or uncertain GPS locations are rejected before location-based publication", () => {
  assert.equal(validLocation(position).latitude,0)
  for (const value of [{...position,accuracy_m:51},{...position,latitude:NaN},
    {...position,longitude:181},{...position,captured_at:"bad"},
    {...position,captured_at:new Date(Date.now()-600000).toISOString()}]) assert.throws(()=>validLocation(value,true))
  assert(isFreshLocation(position.captured_at))
  assert(!isFreshLocation(new Date(Date.now()-180000).toISOString()))
})
test("photo paths cannot escape ownership or reuse another memory's photos", () => {
  const path=`${owner}/${id}/${photo}.jpg`
  assert.deepEqual(validPhotos([path],owner,id),[path])
  for (const paths of [[],[path,path],[`../${path}`],[path.replace(owner,id)],
    [path.replace(`/${id}/`,`/${photo}/`)],[path.replace('.jpg','.svg')],Array(11).fill(path)]) {
    assert.throws(()=>validPhotos(paths,owner,id))
  }
  assert.throws(()=>validTitle("a".repeat(81)))
  assert.equal(validTitle("  "),"この場所の思い出")
})
