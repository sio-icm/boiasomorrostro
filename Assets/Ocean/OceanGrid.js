import * as THREE from 'three';



// Contains the geometry and the methods to find out the cameraGrid matrix (position and orientation)
// It updates the cameraGrid, the position of the mesh-grid and the uniforms
// of the mesh-grid material related to the reprojection of vertices.
// The repositioning of the camera grid was based on the tutorial http://habib.wikidot.com/projected-grid-ocean-shader-full-html-version
export class OceanGrid {

  // TODO: IS VISIBLE USING CAMERA PROJECTION
  constructor (cameraUser, numVertices) {

    this.cameraUser = cameraUser;
    
    // Create camera grid
    this.cameraGrid = new THREE.PerspectiveCamera(cameraUser.fov, cameraUser.aspect, cameraUser.near, cameraUser.far);
  
    // Create grid geometry
    this.size = 5;
    // Public
    this.gridGeom = this.createPlaneGeometry(numVertices, 20);
    this.distanceFrontCamera = this.size / Math.tan(this.cameraUser.fov*Math.PI/180); // HACK WARN TODO: CHECK THIS FORMULA

    // Compression on the height of the plane geometry (useful when frustrum above horizon)
    // WARN --> IN THIS SIMULATION IT IS NOT USED, WHY?
    this.yHeightScale = 1;

    // Memory management
    this.tempVec4 = new THREE.Vector4();
    this.rowCentralVertex = new THREE.Vector3();
    this.rayCameraUserToRowCentralVertex = new THREE.Vector3();
    this.intersectionPoint = new THREE.Vector3();
    this.rayCameraUserToIntersectPoint = new THREE.Vector3();
    this.camGridPosition = new THREE.Vector3();
    this.oppositeRowCentralVertex = new THREE.Vector3();
    this.secondIntersectionPoint = new THREE.Vector3();
    this.gridTopCentralVertex = new THREE.Vector3();
    this.gridBottomCentralVertex = new THREE.Vector3();
    this.camGridTarget = new THREE.Vector3();
  }



  createPlaneGeometry = function(numVertices, extraYFactor){

    // Calculate X and Y according to number of vertices
    numVertices = numVertices || 120000;
    extraYFactor = extraYFactor || 4;
    let size = this.size;
    let divisions = Math.floor(Math.sqrt(numVertices/extraYFactor));
    
    let gridGeom = new THREE.PlaneGeometry( size, size, divisions , divisions * extraYFactor );

    console.log("Number of vertices: " + divisions * divisions * extraYFactor);
    
    // Randomize grid vertex positions to avoid aliasing
    let vertices = gridGeom.attributes.position.array;
    for (let i = 0; i < (vertices.length/3) - 1; i++){
      let x = vertices[i*3];
      let y = vertices[i*3 + 1];
      // Avoid modifying sides of the plane
      if (x != Math.abs(size/2) && y != Math.abs(size/2)){
        let step = 0.5 * size/divisions;
        let randNum = (Math.random() - 1) * 2;
        vertices[i*3] = x + randNum * step;
        vertices[i*3 + 1] = y + randNum * step / extraYFactor; // More divisions in this axis
      }
    }

    return gridGeom;
  }




  updateCameraGrid = function(){

    // Create the central top or bottom vertex
    // When cameraUser is below XZ plane, the central vertex of the last row should be taken
    if (this.cameraUser.position.y >= 0)
      this.tempVec4.set(0, this.size/2, 0, 1); // Top row central vertex
    else{
      this.tempVec4.set(0, -this.size/2, 0, 1); // Bottom row central vertex
    }

    // Move vertex in front of the cameraUser
    // Calculate distance that plane should be from camera according to FOV of camera
    this.cameraUser.translateZ(-this.distanceFrontCamera);
    this.cameraUser.updateMatrix();
    this.tempVec4 = this.tempVec4.applyMatrix4(this.cameraUser.matrix, this.tempVec4);
    this.cameraUser.translateZ(this.distanceFrontCamera);
    this.cameraUser.updateMatrix();
    // Homogeneous division if needed
    if (this.tempVec4.w != 0)
      this.tempVec4.divideScalar(this.tempVec4.w);

    // Assing to top/bottom central vertex
    this.rowCentralVertex.set(this.tempVec4.x, this.tempVec4.y, this.tempVec4.z);

    // Ray from camera to top/bottom central vertex
    this.rayCameraUserToRowCentralVertex.subVectors(this.rowCentralVertex, this.cameraUser.position);
    let ray = this.rayCameraUserToRowCentralVertex;
    
    // Common case (ray is not looking at inifinity or horizon)
    if (ray.y !== 0){
      // Calculate intersection with XZ plane and ray
      let t = (0 - this.cameraUser.position.y) / ray.y;
      this.intersectionPoint.copy(this.cameraUser.position).add(ray.multiplyScalar(t));

      // Check if intersection point is behind the camera
      this.rayCameraUserToRowCentralVertex.subVectors(this.rowCentralVertex, this.cameraUser.position);
      this.rayCameraUserToIntersectPoint.subVectors(this.intersectionPoint, this.cameraUser.position);
      let dotResult = this.rayCameraUserToRowCentralVertex.dot(this.rayCameraUserToIntersectPoint);
      // Intersect point is behind the camera
      if (dotResult < 0) {
        // Find intersection between frustrum and XZ plane: on the horizon, ahead of the camera
        this.intersectionPoint.copy(this.cameraUser.position).add(this.rayCameraUserToRowCentralVertex);
        this.toHorizon(this.intersectionPoint);
        // Calculate cameraGrid position and orientation
        this.calculateCameraGridMatrix(this.intersectionPoint, this.rowCentralVertex);
      }
      // Intersect point is further away than camera frustrum, i.e., it is approximating the horizon
      else if (this.horizontalDistance(this.intersectionPoint) > this.cameraUser.far) {
        // Limit the intersection point to camera.far
        this.toHorizon(this.intersectionPoint);
        this.calculateCameraGridMatrix(this.intersectionPoint, this.rowCentralVertex);
      }
      // Intersect point is in front of camera and inside frustrum
      else {
        // Copy the cameraUser configuration
        this.updateObjectMatrixAccordingToCamera(this.cameraGrid);
      }
    }

    // Rare case when the ray is looking at the horizon
    else {
      // Find intersection between frustrum and XZ plane: on the horizon, ahead of the camera
      this.intersectionPoint.copy(this.cameraUser.position).add(this.rayCameraUserToRowCentralVertex);
      this.toHorizon(this.intersectionPoint);
      // HACK - COUNTER HACK
      //this.intersectionPoint.multiplyScalar(-1);
      // Calculate cameraGrid position and orientation
      this.calculateCameraGridMatrix(this.intersectionPoint, this.rowCentralVertex);
    }
  }


  // Camera grid must be moved
  calculateCameraGridMatrix = function(intersectionPoint, rowCentralVertex){
    // Find camera position using row central vertex, intersection point and distance from camera to row central vertex
    let distanceCamToVertex = this.cameraUser.position.distanceTo(rowCentralVertex);
    this.camGridPosition.subVectors(rowCentralVertex, intersectionPoint).normalize().multiplyScalar(distanceCamToVertex);
    this.camGridPosition.add(rowCentralVertex);

    this.cameraGrid.position.copy(this.camGridPosition);
    this.cameraGrid.updateMatrix();

    // Find camera direction (forward or target vectors) using the intersection between the opposite row central vertex, which calculates a second
    // intersection point. The camera direction (target) is found by calculating the point between the two intersection points.
    // TODO: Check if central vertex of opposite row is inside frustrum --> ocean must not be painted then!
    // Create the central top or bottom vertex (opposite from rowCentralVertex)
    // When cameraUser is below XZ plane, the opposite central vertex should be the top one
    if (this.cameraUser.position.y >= 0)
      this.tempVec4.set(0, -this.size/2, 0, 1); // Bottom row central vertex
    else{
      this.tempVec4.set(0, this.size/2, 0, 1); // Top row central vertex
    }

    // Move vertex in front of the cameraUser
    // Calculate distance that plane should be from camera according to FOV of camera
    this.cameraUser.translateZ(-this.distanceFrontCamera);
    this.cameraUser.updateMatrix();
    this.tempVec4 = this.tempVec4.applyMatrix4(this.cameraUser.matrix, this.tempVec4);
    this.cameraUser.translateZ(this.distanceFrontCamera);
    this.cameraUser.updateMatrix();
    // Homogeneous division if needed
    if (this.tempVec4.w != 0)
      this.tempVec4.divideScalar(this.tempVec4.w);

    this.oppositeRowCentralVertex.set(this.tempVec4.x, this.tempVec4.y, this.tempVec4.z);

    // Calculate intersection with the XZ plane
    // Calculate ray between central vertex (opposite) and camera position
    // This calculation is similar to the one before, but this time the row
    // central vertex is the one closest to the plane. Here we determine
    // if the ocean grid can actually be seen for example
    // TODO: there will be cases when the sea is moving and it should be visible
    // even though the camera is facing upwards from the horizon
    this.rayCameraUserToRowCentralVertex.subVectors(this.oppositeRowCentralVertex, this.cameraUser.position);
    let ray = this.rayCameraUserToRowCentralVertex;

    // Common case (ray is not looking at inifinity or horizon)
    if (ray.y !== 0){
      // Calculate intersection with XZ plane and ray
      let t = (0 - this.cameraUser.position.y) / ray.y;
      this.secondIntersectionPoint.copy(this.cameraUser.position).add(ray.multiplyScalar(t));

      // Intersect point is further away than camera frustrum, i.e., it is approximating the horizon
      if (this.horizontalDistance(this.secondIntersectionPoint) > this.cameraUser.far) {
        console.log("Do not paint (cameraUser looking towards horizon but too far).");
        return;
      } 

      // Check if intersection point is behind the camera
      this.rayCameraUserToRowCentralVertex.subVectors(this.oppositeRowCentralVertex, this.cameraUser.position);
      this.rayCameraUserToIntersectPoint.subVectors(this.secondIntersectionPoint, this.cameraUser.position);
      let dotResult = this.rayCameraUserToRowCentralVertex.dot(this.rayCameraUserToIntersectPoint);
      // Intersect point is behind the camera
      if (dotResult < 0) {
        console.log("Do not paint (cameraUser looking towards horizon but too far).");
        return;
      }
      else {
        // WARNING -- > ONLY COMES HERE WHEN INTERSECTIONPOINT.LENGTH IS BIGGER THAN FAR. REMOVED THIS
        // CONTINUE SCRIPT
        // CALCULATE CAMERA LOOKAT AND oceanGrid HEIGHT (RANGE)
        // Extend intersect point to horizon
        this.toHorizon(intersectionPoint);
        
        // Calculate top and bottom central vertices of ocean grid
        this.gridTopCentralVertex.subVectors(intersectionPoint, this.cameraGrid.position).normalize().multiplyScalar(this.distanceFrontCamera).add(this.cameraGrid.position);
        this.gridBottomCentralVertex.subVectors(this.secondIntersectionPoint, this.cameraGrid.position).normalize().multiplyScalar(this.distanceFrontCamera).add(this.cameraGrid.position);
        
        let yRange = this.gridBottomCentralVertex.distanceTo(this.gridTopCentralVertex);
        this.yHeightScale = yRange / 4.5; // HACK -> I believe it should be divided by this.size
        this.camGridTarget.addVectors(this.gridTopCentralVertex, this.gridBottomCentralVertex).multiplyScalar(0.5);
        this.cameraGrid.lookAt(this.camGridTarget);
        this.cameraGrid.updateMatrix();
      }
      // TODO ? Intersect point is further away than camera frustrum, i.e., it is approximating the horizon


    }
    // Rare case when the ray is looking at the horizon
    // TODO: if camera is close to plane, maybe paint as waves will come into view?
    else {
      console.log("Do not paint (bottom cameraUser frustrum looking at horizon).")
      return;
    }


  }



  // Distances and the horizon are measured from the camera, not from the scene's origin (the
  // buoy): with the camera far from it (following a vessel) the grid would point elsewhere
  horizontalDistance = function(point){
    return Math.hypot(point.x - this.cameraUser.position.x, point.z - this.cameraUser.position.z);
  }
  // Moves a point to the sea level, cameraUser.far away from the camera in the same direction
  toHorizon = function(point){
    const camera = this.cameraUser.position;
    const distance = this.horizontalDistance(point) || 1;
    point.set(
      camera.x + (point.x - camera.x) / distance * this.cameraUser.far,
      0,
      camera.z + (point.z - camera.z) / distance * this.cameraUser.far,
    );
    return point;
  }


  // Make as if it was a child of camera
  updateObjectMatrixAccordingToCamera = function(node, inCam){
    let cam = inCam || this.cameraUser;
    node.position.copy( cam.position );
    node.rotation.copy( cam.rotation );
    node.updateMatrix();
  }


  // Update uniforms
  updateUniforms = function(material){
    let u = material.uniforms;
    u.u_cameraModelMatrix.value = this.cameraGrid.matrix;
    u.u_cameraGridPosition.value = this.cameraGrid.position;
    u.u_cameraViewportScale.value.x = this.cameraUser.aspect;
    u.u_cameraViewportScale.value.y = this.yHeightScale;
  }



  // PUBLIC
  update = function(oceanMesh){
    // Update camera grid
    this.updateCameraGrid();

    // Move plane in front of camera
    this.updateObjectMatrixAccordingToCamera(oceanMesh, this.cameraGrid);
    oceanMesh.translateZ(-this.distanceFrontCamera);
    oceanMesh.updateMatrix();

    // Update uniforms
    this.updateUniforms(oceanMesh.material);

  }

  getGeometry = function(){
    return this.gridGeom;
  }
  
  




}