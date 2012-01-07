/*=============================================================
  Filename: canvasStack1v00.js
  Rev: 1 (with custom edits!)
  By: A.R.Collins
  Description: A set of utilities create canvas elements able
  to have multiple transparent canvas layers.
  License: Released into the public domain
  latest version at
  <http://www/arc.id.au/CanvasLayers.html>
  Requires:
  - for IE, the canvas emulator 'excanvas-modified.js' from
  <http://groups.google.com/group/google-excanvas/files>.

  Date   |Description                                      |By
  -------------------------------------------------------------
  30Oct09 Rev 1.00 First release                            ARC
  ============================================================= */

  function CanvasStack(holderID, bkgColor)
  {
    // test for IE browser and save
    var ua = navigator.userAgent.toLowerCase();
    this.isIE = (/msie/.test(ua)) && !(/opera/.test(ua)) && (/win/.test(ua));

    this.overlays = new Array();  // an array of layer ids
    this.ovlyNumber = 0;           // counter to generate unique IDs

    this.holderID = holderID;
    this.holderNode = document.getElementById(this.holderID);

    if (this.holderNode.style.position == 'static')
      this.holderNode.style.position = "relative"; // for parenting canvases

    this.bkgCvs = document.createElement('canvas');
    this.bkgCvsId = this.holderID+"_bkg";
    this.bkgCvs.setAttribute('id', this.bkgCvsId);
    this.bkgCvs.setAttribute('width', this.holderNode.clientWidth);
    this.bkgCvs.setAttribute('height', this.holderNode.clientHeight);
    this.bkgCvs.style.backgroundColor = "transparent";
    if (bkgColor != undefined)
      this.bkgCvs.style.backgroundColor = bkgColor;
    this.bkgCvs.style.position = "absolute";
    this.bkgCvs.style.left = "0px";
    this.bkgCvs.style.top = "0px";

    this.holderNode.appendChild(this.bkgCvs);

    // now make sure this dynamic canvas is recognised by the excanvas emulator
    if (this.isIE)
      G_vmlCanvasManager.initElement(this.bkgCvs);
  }

  CanvasStack.prototype.getBackgroundCanvasId = function()
  {
    return this.bkgCvsId;
  }

  CanvasStack.prototype.createLayer = function()
  {
    var newCvs = document.createElement('canvas');
    var ovlId = this.holderID+"_ovl_"+this.ovlyNumber;

    this.ovlyNumber++;   // increment the count to make unique ids
    newCvs.setAttribute('id', ovlId);
    newCvs.setAttribute('width', this.holderNode.clientWidth);
    newCvs.setAttribute('height', this.holderNode.clientHeight);
    newCvs.style.backgroundColor = "transparent";
    newCvs.style.position = "absolute";
    newCvs.style.left = "0px";
    newCvs.style.top = "0px";

    this.holderNode.appendChild(newCvs);

    // now make sure this dynamic canvas is recognised by the excanvas emulator
    if (this.isIE)
      G_vmlCanvasManager.initElement(newCvs);

    // save the ID in a global array to facilitate removal
    this.overlays.push(ovlId);

    return ovlId;    // return the new canavs id for call to getGraphicsContext
  }

  CanvasStack.prototype.deleteLayer = function(ovlyId)
  {
    var idx = -1;
    for (var i=0; i<this.overlays.length; i++)
    {
      if (this.overlays[i] == ovlyId)
        idx = i;
    }
    if (idx == -1)
    {
      alert("overlay not found");
      return;
    }
    var ovlNode = document.getElementById(ovlyId);
    if (!ovlNode)       // there is a id stored but no actual canvas
    {
      alert("overlay node not found");
      this.overlays.splice(idx,1);       // delete the lost id
      return;
    }

    var papa = ovlNode.parentNode;

    this.holderNode.removeChild(ovlNode);
    // now delete _overlay array element
    this.overlays.splice(idx,1);       // delete the id
  }

  CanvasStack.prototype.deleteAllLayers = function()
  {
    var ovlNode;
    for (var i=this.overlays.length-1; i>=0; i--)
    {
      ovlNode = document.getElementById(this.overlays[i]);
      if (ovlNode)
      {
        this.holderNode.removeChild(ovlNode);
      }
      // now delete _overlay array element
      this.overlays.splice(i,1);       // delete the orphan
    }
  }

