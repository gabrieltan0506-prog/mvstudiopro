"""Only server-normalized local PNG assets. No URL/network loading, scripts, or blend imports."""
import hashlib

import bpy

from manhua_vfx_math import validate_image_path


def build_image_overlay(event,spec,scene,asset_root):
    path,receipt=validate_image_path(event['imagePath'],asset_root)
    receipt.update(sha256=hashlib.sha256(path.read_bytes()).hexdigest(),imageUri=event['imageUri'])
    image=bpy.data.images.load(str(path),check_existing=True)
    if tuple(image.size)!=(receipt['width'],receipt['height']):raise ValueError('Decoded image dimensions differ from prepared PNG header')
    image.alpha_mode='STRAIGHT';image.colorspace_settings.name='sRGB'
    image.pack()
    # Match every other VFX: scale is a fraction of destination frame height.
    height=1.;width=receipt['width']/receipt['height']
    mesh=bpy.data.meshes.new(event['id']+'_image_plane')
    mesh.from_pydata([(-width/2,-height/2,0),(width/2,-height/2,0),(width/2,height/2,0),(-width/2,height/2,0)],[],[(0,1,2,3)])
    mesh.update();uv=mesh.uv_layers.new()
    for datum,coordinate in zip(uv.data,((0,0),(1,0),(1,1),(0,1))):datum.uv=coordinate
    obj=bpy.data.objects.new(event['id']+'_image',mesh);scene.collection.objects.link(obj)
    material=bpy.data.materials.new(event['id']+'_image_alpha');material.use_nodes=True
    nodes,links=material.node_tree.nodes,material.node_tree.links;nodes.clear()
    texture=nodes.new('ShaderNodeTexImage');texture.image=image;texture.interpolation='Linear';texture.extension='CLIP'
    emission=nodes.new('ShaderNodeEmission');links.new(texture.outputs['Color'],emission.inputs['Color'])
    transparent=nodes.new('ShaderNodeBsdfTransparent')
    opacity=nodes.new('ShaderNodeMath');opacity.operation='MULTIPLY';opacity.inputs[1].default_value=1
    links.new(texture.outputs['Alpha'],opacity.inputs[0])
    mix=nodes.new('ShaderNodeMixShader');links.new(opacity.outputs[0],mix.inputs[0])
    links.new(transparent.outputs[0],mix.inputs[1]);links.new(emission.outputs[0],mix.inputs[2])
    output=nodes.new('ShaderNodeOutputMaterial');links.new(mix.outputs[0],output.inputs['Surface'])
    if hasattr(material,'surface_render_method'):material.surface_render_method='BLENDED'
    else:material.blend_method='BLEND'
    mesh.materials.append(material)
    return obj,opacity.inputs[1],receipt
