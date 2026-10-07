"""Six fixed, stylized screen-space effects. No volume simulation or arbitrary shaders."""
import math
import random

import bpy

EXTRA_KINDS = frozenset(('fire_burst', 'smoke_plume', 'lightning', 'shockwave', 'speed_lines', 'magic_circle'))


def cloud_material(name, color):
    """Soft, internally textured smoke sprites; transparent pixels, not black smoke plates."""
    mat=bpy.data.materials.new(name)
    mat.use_nodes=True
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    nodes.clear()
    output=nodes.new('ShaderNodeOutputMaterial')
    emission=nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value=(*color,1)
    transparent=nodes.new('ShaderNodeBsdfTransparent')
    mix=nodes.new('ShaderNodeMixShader')
    uv=nodes.new('ShaderNodeTexCoord')
    noise=nodes.new('ShaderNodeTexNoise')
    noise.noise_dimensions='4D'
    noise.inputs['Scale'].default_value=4.8
    noise.inputs['Detail'].default_value=3.2
    noise.inputs['Roughness'].default_value=.7
    links.new(uv.outputs['UV'],noise.inputs['Vector'])
    distance=nodes.new('ShaderNodeVectorMath')
    distance.operation='DISTANCE'
    distance.inputs[1].default_value=(.5,.5,0)
    links.new(uv.outputs['UV'],distance.inputs[0])
    falloff=nodes.new('ShaderNodeMapRange')
    falloff.inputs['From Min'].default_value=.08
    falloff.inputs['From Max'].default_value=.5
    falloff.inputs['To Min'].default_value=1
    falloff.inputs['To Max'].default_value=0
    falloff.clamp=True
    links.new(distance.outputs['Value'],falloff.inputs['Value'])
    density=nodes.new('ShaderNodeMath')
    density.operation='MULTIPLY'
    links.new(falloff.outputs['Result'],density.inputs[0])
    links.new(noise.outputs['Fac'],density.inputs[1])
    opacity=nodes.new('ShaderNodeMath')
    opacity.operation='MULTIPLY'
    opacity.inputs[1].default_value=.5
    links.new(density.outputs[0],opacity.inputs[0])
    shade=nodes.new('ShaderNodeMapRange')
    shade.inputs['To Min'].default_value=.38
    shade.inputs['To Max'].default_value=1.15
    links.new(noise.outputs['Fac'],shade.inputs['Value'])
    links.new(shade.outputs['Result'],emission.inputs['Strength'])
    links.new(opacity.outputs[0],mix.inputs[0])
    links.new(transparent.outputs[0],mix.inputs[1])
    links.new(emission.outputs[0],mix.inputs[2])
    links.new(mix.outputs[0],output.inputs['Surface'])
    if hasattr(mat,'surface_render_method'):
        mat.surface_render_method='BLENDED'
    else:
        mat.blend_method='BLEND'
    return mat,opacity.inputs[1],noise.inputs['W']


def build_extra(event, scene, mats, rng, helpers):
    make_strip,make_glow,make_mat,color=helpers
    mat,core,glow=mats
    kind=event['kind']
    strips,particles,rings=[],[],[]
    extra={'kind':kind,'random':[[rng.random() for _ in range(6)] for _ in range(64)]}
    if kind=='fire_burst':
        for i in range(14):
            strips.append(make_strip(event['id']+'_flame_%d'%i,scene,core if i%4==0 else mat,32))
        for i in range(30):
            particles.append(make_glow(event['id']+'_hot_ember_%d'%i,scene,glow))
    elif kind=='smoke_plume':
        smoke,opacity,w=cloud_material(event['id']+'_smoke_density',color)
        extra.update(smokeOpacity=opacity,smokeTime=w)
        for i in range(24):
            particles.append(make_glow(event['id']+'_smoke_puff_%d'%i,scene,smoke))
    elif kind=='lightning':
        halo,halo_opacity=make_mat(event['id']+'_arc_halo',color)
        extra['haloOpacity']=halo_opacity
        for i in range(2):
            strips.append(make_strip(event['id']+'_bolt_%d'%i,scene,core if i else halo,32))
        for i in range(8):
            strips.append(make_strip(event['id']+'_branch_%d'%i,scene,mat,12))
        for i in range(2):
            particles.append(make_glow(event['id']+'_arc_contact_%d'%i,scene,glow))
    elif kind=='shockwave':
        for i in range(4):
            rings.append(make_strip(event['id']+'_wavefront_%d'%i,scene,core if i==0 else mat,96))
    elif kind=='speed_lines':
        for i in range(48):
            strips.append(make_strip(event['id']+'_speed_%d'%i,scene,core if i%4==0 else mat,2))
    elif kind=='magic_circle':
        for i in range(4):
            rings.append(make_strip(event['id']+'_seal_ring_%d'%i,scene,core if i%2==0 else mat,96))
        for i in range(18):
            strips.append(make_strip(event['id']+'_seal_geometry_%d'%i,scene,mat,4))
    else:
        raise ValueError('Unsupported fixed effect')
    extra.update(strips=strips,particles=particles,rings=rings,objects=strips+particles+rings)
    return extra


def update_extra(handle, spec, time, state, set_strip):
    extra=handle['extra']
    kind,q,fade=extra['kind'],state['progress'],state['opacity']
    rows,strips,particles,rings=extra['random'],extra['strips'],extra['particles'],extra['rings']
    if kind=='fire_burst':
        growth=.35+.65*math.sin(min(1.,q*2)*math.pi/2)
        for i,obj in enumerate(strips):
            r=rows[i]
            base_x=(r[0]-.5)*.7*(.5+q)
            height=(.45+r[1]*.5)*growth
            points=[]
            for j in range(33):
                u=j/32
                x=base_x*(1-u*.45)+math.sin(u*8+q*22+r[2]*math.tau)*.04*u
                y=-.32+u*height
                points.append((x,y))
            set_strip(obj,points,[math.sin(math.pi*j/32)**.7*(.022+r[3]*.035)*(1-j/32*.75) for j in range(33)],i*.001)
        for i,obj in enumerate(particles):
            r=rows[i+14]
            u=(q+r[0])%1
            obj.location=((r[1]-.5)*(.2+.85*u),-.27+u*(.4+r[2]*.6),.025+r[4]*.005)
            size=(.012+r[3]*.025)*(1-u*.65)
            obj.scale=(size,size*(1.5+u),size)
    elif kind=='smoke_plume':
        extra['smokeOpacity'].default_value=min(1.,fade*1.7)
        extra['smokeTime'].default_value=time*.8+(spec['seed']%100)*.1
        for i,obj in enumerate(particles):
            r=rows[i]
            age=max(0.,q-r[0]*.28)
            obj.location=((r[1]-.5)*(.15+age*.85)+.11*math.sin(age*6+r[2]*math.tau),
                          -.3+age*(.4+r[3]*.7),i*.002)
            size=(.07+r[4]*.07)*(1+age*1.7)
            obj.scale=(size,size*(.7+r[5]*.6),size)
            obj.rotation_euler.z=r[2]*math.tau+age*(r[3]-.5)
    elif kind=='lightning':
        # Reproducible piecewise electrical flicker, independent of evaluation order.
        rng=random.Random(spec['seed']+int(math.floor(time*18))*104729+int(rows[0][0]*10000))
        points=[((rng.random()-.5)*.18*math.sin(math.pi*i/32),.55-i/32*1.1) for i in range(33)]
        extra['haloOpacity'].default_value=fade*.28
        for i,obj in enumerate(strips[:2]):
            set_strip(obj,points,[.021 if i==0 else .004]*33,i*.003)
        for i,obj in enumerate(strips[2:]):
            root_index=4+i*3
            origin=points[root_index]
            r=rows[i]
            direction=-1 if i%2 else 1
            branch=[(origin[0]+direction*j/12*(.12+r[0]*.22),
                     origin[1]-j/12*(.08+r[1]*.2)+(rng.random()-.5)*.04*math.sin(math.pi*j/12)) for j in range(13)]
            set_strip(obj,branch,[.003*(1-j/13) for j in range(13)],.005)
        for i,obj in enumerate(particles):
            obj.location=(0,.55 if i==0 else -.55,.01)
            obj.scale=(.045,.045,.045)
    elif kind=='shockwave':
        for i,obj in enumerate(rings):
            age=max(0.,q-i*.06)
            radius=.08+.62*math.sqrt(age)
            points=[]
            for j in range(97):
                a=j/96*math.tau
                rad=radius*(1+.018*math.sin(a*13+q*11+i))
                points.append((rad*math.cos(a),rad*.67*math.sin(a)))
            set_strip(obj,points,[(.008 if i==0 else .014)*(1-q*.85)]*97,.003*i)
    elif kind=='speed_lines':
        for i,obj in enumerate(strips):
            r=rows[i]
            angle=math.tau*(i+r[0]*.6)/48
            pulse=(q*1.9+r[1])%1
            radius=.24+pulse*.4
            length=.12+r[2]*.3
            points=[((radius+length*j/2)*math.cos(angle),(radius+length*j/2)*math.sin(angle)) for j in range(3)]
            set_strip(obj,points,[.0005,.002+r[3]*.003,.0002],r[4]*.004)
    elif kind=='magic_circle':
        for i,obj in enumerate(rings):
            radius=(.48,.425,.32,.15)[i]
            turn=q*(.5 if i%2 else -.4)
            # Draw the ring continuously during its opening, then keep complete geometry.
            progress=min(1.,.08+q*4)
            points=[(radius*math.cos(j/96*math.tau*progress+turn),
                     radius*.68*math.sin(j/96*math.tau*progress+turn)) for j in range(97)]
            set_strip(obj,points,[.004 if i%2 else .006]*97,i*.002)
        for i,obj in enumerate(strips):
            angle=i/18*math.tau-q*.4
            # Geometric diamonds and spokes; no invented readable language.
            if i%3:
                local=((.35,0),(.38,.02),(.41,0),(.38,-.02),(.35,0))
            else:
                local=((.15,0),(.22,.035),(.27,0),(.22,-.035),(.15,0))
            points=[(x*math.cos(angle)-y*math.sin(angle),(x*math.sin(angle)+y*math.cos(angle))*.68) for x,y in local]
            set_strip(obj,points,[.003]*5,.012)
