"""导出时钟选项契约；不调用Blender、不生成GLB或图片。"""
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from manhua_vfx_stage_export import export_world_animation


class ExportTimingTests(unittest.TestCase):
    def invoke(self, properties):
        operation = Mock()
        operation.get_rna_type.return_value = SimpleNamespace(properties=properties)
        bpy = SimpleNamespace(ops=SimpleNamespace(export_scene=SimpleNamespace(gltf=operation)),
                              context=SimpleNamespace(view_layer=SimpleNamespace(objects=SimpleNamespace(active=None))))
        scene = SimpleNamespace(frame_set=Mock())
        with tempfile.TemporaryDirectory() as directory, patch.dict(sys.modules, {'bpy': bpy}), patch(
                'manhua_vfx_stage_export.bake_world_animation', return_value=(set(), {'rig'}, {'frames': []}, [])):
            export_world_animation(scene, {}, {}, {}, {}, directory, None)
            self.assertTrue((Path(directory) / 'world-animation.frames.json').exists())
        return operation

    def test_scene_animation_starts_at_consumer_zero(self):
        properties = {'export_animation_mode': SimpleNamespace(enum_items=[SimpleNamespace(identifier='SCENE')]),
                      'export_anim_slide_to_zero': object()}
        operation = self.invoke(properties)
        self.assertIs(operation.call_args.kwargs['export_anim_slide_to_zero'], True)
        self.assertEqual(operation.call_args.kwargs['export_animation_mode'], 'SCENE')
        self.assertTrue(operation.call_args.kwargs['export_frame_range'])

    def test_unsupported_exporter_fails_instead_of_silent_frame_delay(self):
        properties = {'export_animation_mode': SimpleNamespace(enum_items=[SimpleNamespace(identifier='SCENE')])}
        with self.assertRaisesRegex(ValueError, '动画时间归零'):
            self.invoke(properties)


if __name__ == '__main__':
    unittest.main()
