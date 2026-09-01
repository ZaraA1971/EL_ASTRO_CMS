import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanHtml,
  normalizeInlineStyles,
  filterStyleDeclarations,
  stripFontJunk,
} from './html-clean.mjs';

describe('html-clean', () => {
  it('keeps text-align, drops paste colors/fonts', () => {
    const dirty =
      '<p style="text-align: center; margin-top: 13px; caret-color: rgb(0, 0, 0); color: rgb(0, 0, 0); font-family: arial; font-size: 14px;"><b>Diversité</b></p>';
    const clean = cleanHtml(dirty, 'store');
    assert.equal(
      clean,
      '<p style="text-align: center"><b>Diversité</b></p>'
    );
  });

  it('removes style attribute when nothing allowed remains', () => {
    const dirty =
      '<p style="margin-top: 13px; color: rgb(0, 0, 0); font-family: arial;">texte</p>';
    assert.equal(cleanHtml(dirty, 'desk'), '<p>texte</p>');
  });

  it('normalizes unquoted style attributes', () => {
    const dirty = '<p style=color:rgb(0,0,0)>x</p>';
    assert.equal(cleanHtml(dirty, 'store'), '<p>x</p>');
  });

  it('strips font tags and presentation attrs', () => {
    const dirty = '<p><font color="#000000" face="Arial">Hello</font></p>';
    assert.equal(cleanHtml(dirty, 'desk'), '<p>Hello</p>');
  });

  it('extracts Word clipboard fragment and drops rgb styles', () => {
    const dirty = `<html><body><!--StartFragment-->
<p style="color: rgb(0, 0, 0); font-family: arial;">Hello</p>
<!--EndFragment--></body></html>`;
    assert.equal(cleanHtml(dirty, 'desk'), '<p>Hello</p>');
  });

  it('strips empty strong with only nbsp', () => {
    const dirty = '<p>dit<strong>&nbsp;</strong>«&nbsp;ok»</p>';
    assert.equal(cleanHtml(dirty, 'store'), '<p>dit «&nbsp;ok»</p>');
  });

  it('strips ProseMirror data attrs', () => {
    const dirty = '<p data-pm-slice="1 1 []" data-start="0">x</p>';
    assert.equal(cleanHtml(dirty, 'store'), '<p>x</p>');
  });

  it('strips empty paragraphs on store/desk', () => {
    assert.equal(cleanHtml('<p>a</p><p></p>', 'store'), '<p>a</p>');
    assert.equal(cleanHtml('<p>a</p><p></p>', 'ios'), '<p>a</p><p></p>');
  });

  it('filterStyleDeclarations allowlists text-align only', () => {
    assert.equal(
      filterStyleDeclarations(
        'color: #000; text-align: center; font-size: 14px'
      ),
      'text-align: center'
    );
    assert.equal(filterStyleDeclarations('color: black'), '');
  });

  it('normalizeInlineStyles is idempotent on clean markup', () => {
    const html = '<p style="text-align: center"><b>x</b></p><p>y</p>';
    assert.equal(normalizeInlineStyles(html), html);
  });

  it('stripFontJunk unwraps font', () => {
    assert.equal(stripFontJunk('<font size="2">a</font>'), 'a');
  });

  it('rejects unknown context', () => {
    assert.throws(() => cleanHtml('<p>x</p>', 'hero'), /contexte inconnu/);
  });

  it('promotes span font-weight/italic to b/i', () => {
    assert.equal(
      cleanHtml(
        '<p><span style="font-weight: bold; color: rgb(0, 0, 0)">x</span></p>',
        'desk'
      ),
      '<p><b>x</b></p>'
    );
    assert.equal(
      cleanHtml(
        '<p><span style="font-weight:700"><span style="font-style:italic">y</span></span></p>',
        'store'
      ),
      '<p><b><i>y</i></b></p>'
    );
  });

  it('unwraps nested and adjacent identical phrasing', () => {
    assert.equal(cleanHtml('<p><b><b>z</b></b></p>', 'desk'), '<p><b>z</b></p>');
    assert.equal(
      cleanHtml('<p><b>a</b><b>b</b></p>', 'store'),
      '<p><b>ab</b></p>'
    );
    assert.equal(
      cleanHtml('<p><span>nu</span></p>', 'desk'),
      '<p>nu</p>'
    );
  });

  it('strips embedded style blocks from clipboard', () => {
    const dirty =
      '<style>p{color:red;font-family:Comic Sans}</style><p>Hello</p>';
    assert.equal(cleanHtml(dirty, 'paste'), '<p>Hello</p>');
  });

  it('unwraps Google Docs fake-bold wrapper', () => {
    const dirty =
      '<b style="font-weight:normal;" id="docs-internal-guid-abc"><span style="color:#000;font-family:Arial">Hello</span></b>';
    assert.equal(cleanHtml(dirty, 'paste'), 'Hello');
  });

  it('keeps real bold inside a Docs wrapper', () => {
    const dirty =
      '<b id="docs-internal-guid-abc" style="font-weight:normal"><p>a <span style="font-weight:700">b</span></p></b>';
    assert.equal(cleanHtml(dirty, 'paste'), '<p>a <b>b</b></p>');
  });

  it('drops class/id/align from pasted tags', () => {
    const dirty =
      '<p class="MsoNormal" id="x" align="left" style="color:#000">texte</p>';
    assert.equal(cleanHtml(dirty, 'desk'), '<p>texte</p>');
  });

  it('flattens pasted headings only in paste context', () => {
    assert.equal(
      cleanHtml('<h2 style="color:red">Titre</h2>', 'paste'),
      '<p>Titre</p>'
    );
    assert.equal(cleanHtml('<h2>Titre</h2>', 'desk'), '<h2>Titre</h2>');
  });

  it('normalize inline markup is idempotent', () => {
    const once = cleanHtml(
      '<p><span style="font-weight:bold">a</span><span style="font-weight:700">b</span></p>',
      'desk'
    );
    assert.equal(once, '<p><b>ab</b></p>');
    assert.equal(cleanHtml(once, 'desk'), once);
  });
});
