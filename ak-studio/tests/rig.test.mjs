import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const rig = JSON.parse(await readFile(new URL('../assets/ak47-rig.json', import.meta.url), 'utf8'));
const SIZES = {translation: 3, rotation: 4, scale: 3};
const bones = rig.nodes.filter(node => node.inverseBind);

test('the rig is one tree holding the weapon, magazine, trigger and bolt bones', () => {
  rig.nodes.forEach((node, index) => assert.ok(node.parent < index, 'parents come before their children'));
  assert.equal(rig.nodes.filter(node => node.parent < 0).length, 1);
  for (const bone of bones) assert.equal(bone.inverseBind.length, 16);
  for (const part of ['weapon_hand_r', 'clip', 'trigger', 'bolt']) assert.ok(bones.some(bone => bone.name.includes(part)), `missing ${part}`);
});

test('every clip has well-formed tracks on the rig bones', () => {
  assert.deepEqual(rig.clips.map(clip => clip.name), ['Idle', 'Draw', 'Reload', 'Fire']);
  for (const clip of rig.clips) {
    assert.ok(clip.tracks.length > 0);
    for (const track of clip.tracks) {
      assert.ok(rig.nodes[track.node].inverseBind, `${clip.name} animates something that is not a bone`);
      assert.equal(track.values.length, track.times.length * SIZES[track.path]);
      assert.ok([...track.times, ...track.values].every(Number.isFinite));
      assert.ok(track.times.every((time, index) => index === 0 || time > track.times[index - 1]), 'times increase');
      assert.ok(track.times.at(-1) <= clip.duration + 1e-6);
    }
  }
});

test('the clips move what their names promise', () => {
  const travel = (name, part) => {
    const track = rig.clips.find(clip => clip.name === name).tracks.find(candidate => candidate.path === 'translation' && rig.nodes[candidate.node].name.includes(part));
    let far = 0;
    for (let i = 0; i < track.values.length; i += 3) far = Math.max(far, Math.hypot(track.values[i] - track.values[0], track.values[i + 1] - track.values[1], track.values[i + 2] - track.values[2]));
    return far;
  };
  assert.equal(rig.clips[0].duration, 0, 'idle is a single pose');
  assert.ok(travel('Reload', 'clip') > 5, 'the magazine leaves the weapon');
  assert.ok(travel('Fire', 'bolt') > 1 && travel('Draw', 'bolt') > 1, 'the bolt cycles');
  assert.ok(travel('Draw', 'weapon_hand_r') > .1, 'the weapon is raised');
});

test('the model the rig was copied from is credited', () => {
  assert.match(rig.attribution.license, /CC-BY/);
  assert.ok(rig.attribution.author && rig.attribution.source);
});
